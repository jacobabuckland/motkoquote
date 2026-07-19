import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

// Sends the caller a test notification to every device they've registered.
// Backs the "Send test notification" button in Settings so a contractor can
// confirm push works before they rely on it for a real money moment.
export const POST = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const summary = await sendPushToUser(createAdminClient(), user.id, {
    event: "test",
    title: "Motko notifications are on",
    body: "This is a test notification. You're all set.",
    url: `${appUrl}/dashboard`,
  });

  return NextResponse.json({
    ok: summary.sent > 0,
    devices: summary.devices,
    sent: summary.sent,
    failed: summary.failed,
    failures: summary.failures,
  });
};
