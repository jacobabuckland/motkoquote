import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pushSubscriptionInputSchema } from "@/lib/schemas/notification";

// Registers (or refreshes) the caller's push subscription. Web clients post
// their VAPID keys; native iOS clients post an APNs device token. Auth-scoped:
// the row is always keyed to the signed-in user, and RLS keeps a user from
// touching anyone else's subscriptions. Re-registering the same endpoint /
// token replaces the old row so keys stay current without duplicating.
export const POST = async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = pushSubscriptionInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const input = parsed.data;

  if (input.platform === "webpush") {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", input.endpoint);
    const { error } = await supabase.from("push_subscriptions").insert({
      user_id: user.id,
      platform: "webpush",
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: request.headers.get("user-agent"),
    });
    if (error) {
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  } else {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("device_token", input.device_token);
    // The native shell's build goes into `user_agent`, the column that already
    // answers "what client registered this" for web push. A dedicated column
    // would query more cleanly, but schema-before-code makes that two PRs and a
    // manual production apply (see areas/motko.md, 1 Sep) — too much ceremony
    // for a diagnostic string, and this is reversible if it earns its own
    // column later. The `Motko/<version> (<build>)` prefix is fixed so a
    // `like 'Motko/%'` query can pick the shells out, and the WKWebView's own
    // user-agent follows it because that is where the iOS version lives.
    const requestAgent = request.headers.get("user-agent");
    const shell = input.app_version
      ? `Motko/${input.app_version} (${input.app_build ?? "unknown"})`
      : null;
    const { error } = await supabase.from("push_subscriptions").insert({
      user_id: user.id,
      platform: "apns",
      device_token: input.device_token,
      user_agent: [shell, requestAgent].filter(Boolean).join(" ") || null,
    });
    if (error) {
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
};

// Removes a subscription the client is tearing down (browser permission
// revoked, notifications toggled off). Web clients pass their endpoint; native
// clients pass their device token.
export const DELETE = async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  const deviceToken = request.nextUrl.searchParams.get("device_token");
  if (!endpoint && !deviceToken) {
    return NextResponse.json({ error: "Nothing to remove" }, { status: 400 });
  }

  let query = supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id);
  query = endpoint
    ? query.eq("endpoint", endpoint)
    : query.eq("device_token", deviceToken!);
  await query;

  return NextResponse.json({ ok: true });
};
