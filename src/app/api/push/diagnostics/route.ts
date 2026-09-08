import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Records WHY a native push registration failed, so the answer survives the
// device it happened on.
//
// The client already computed these facts — `gatherDiagnostics` in
// @/lib/push/native has done so since 1 Sep — and wrote them to console.error.
// On a downloaded build that needs a Mac, a cable and Console.app, so in
// practice nobody ever read them: reconstructing one occurrence on 8 Sep 2026
// took two days across Xcode archives, the Apple developer portal and App Store
// Connect, and the answer (the live App Store build was seven weeks older than
// the web app it loaded) was in none of those places.
//
// This is NOT the signal that changes behaviour — the Settings toast is, and it
// fires whether or not this route is reached. This is the evidence behind it.
//
// Auth-scoped: a diagnostics row is attributable to the contractor who hit it,
// and an unauthenticated caller could otherwise fill the events table.

const diagnosticsSchema = z.object({
  // Only the two failing outcomes are worth a row. "registered" needs no
  // record — a push_subscriptions row IS the record — and "denied" is the
  // contractor's own choice, not a fault.
  status: z.enum(["no-token", "error"]),
  cause: z.enum(["not-native", "plugin-missing", "provisioning"]).optional(),
  code: z.string().max(40).optional(),
  timeout_ms: z.number().int().nonnegative().max(600_000).optional(),
  // `unavailable` is a real, meaningful value here: it means @capacitor/core
  // would not even import, which is itself the diagnosis.
  is_native_platform: z.union([z.boolean(), z.literal("unavailable")]).nullable(),
  platform: z.string().max(40).nullable(),
  plugin_resolved: z.boolean().nullable(),
  permission: z.string().max(40).nullable(),
});

export const POST = async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const parsed = diagnosticsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid diagnostics" }, { status: 400 });
  }

  // Deliberately no device token and no request body echo. The token is the
  // thing that never arrived, and a real one is a credential.
  const { error } = await supabase.from("events").insert({
    user_id: user.id,
    event_name: "push_registration_failed",
    properties: {
      ...parsed.data,
      user_agent: request.headers.get("user-agent"),
    },
  });

  if (error) {
    // Logged, not returned as a failure. The client never surfaces this
    // response — a diagnostics write that fails must not become a second
    // problem on top of the one being reported.
    console.error("[push/diagnostics] could not record failure", error);
  }

  return NextResponse.json({ ok: true });
};
