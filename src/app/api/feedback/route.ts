import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackEvent } from "@/lib/track";
import { logError } from "@/lib/errors";

const MESSAGE_MAX = 4000;

/**
 * In-app feedback valve. Requires an authenticated contractor. Stores the
 * message, fires feedback_submitted, and (best-effort) emails Jacob if
 * FEEDBACK_NOTIFY_EMAIL is set. Failures never surface to the user beyond a
 * generic error.
 */
export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const raw = typeof body?.message === "string" ? body.message.trim() : "";
    if (!raw) return NextResponse.json({ ok: false }, { status: 400 });
    const message = raw.slice(0, MESSAGE_MAX);
    const path = typeof body?.path === "string" ? body.path : null;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });

    const { data: contractor } = await supabase
      .from("contractors")
      .select("id")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    const contractorId = contractor?.id ?? null;

    const admin = createAdminClient();
    await admin.from("feedback").insert({
      user_id: user.id,
      contractor_id: contractorId,
      message,
      path,
      user_agent: request.headers.get("user-agent"),
    });

    await trackEvent(
      "feedback_submitted",
      { length: message.length },
      { userId: user.id, contractorId, path },
    );

    await notifyJacob(message, user.email ?? null, path);

    return NextResponse.json({ ok: true });
  } catch (error) {
    await logError("feedback", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
};

const notifyJacob = async (
  message: string,
  fromEmail: string | null,
  path: string | null,
): Promise<void> => {
  const to = process.env.FEEDBACK_NOTIFY_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "quotes@motko.app",
      to,
      subject: "New tester feedback",
      html: `
        <p><strong>From:</strong> ${fromEmail ?? "unknown"}</p>
        <p><strong>Path:</strong> ${path ?? "unknown"}</p>
        <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
      `,
    });
  } catch {
    // Best-effort — a failed notification must never fail the submission.
  }
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
