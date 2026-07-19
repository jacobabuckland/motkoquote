import webpush from "web-push";
import type { PushPayload } from "@/lib/push/payload";

// A single VAPID web push subscription row, narrowed to the fields web-push
// needs to encrypt and deliver a message.
export type WebPushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// Result of an attempted send. `gone` marks a subscription the push service has
// permanently rejected (404/410) — the caller prunes those so we stop trying.
export type WebPushResult = {
  ok: boolean;
  gone: boolean;
  status?: number;
  reason?: string;
};

let configured = false;

// Wires web-push with our VAPID keys on first use. Returns false when keys are
// absent so callers can no-op instead of throwing (mirrors the email lib).
const ensureConfigured = (): boolean => {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:support@motko.app";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
};

// Encrypts and delivers one payload to one browser subscription. Never throws:
// transport failures resolve to { ok: false }, and a permanently-dead endpoint
// resolves with gone: true so the caller can delete the row.
export const sendWebPush = async (
  target: WebPushTarget,
  payload: PushPayload,
): Promise<WebPushResult> => {
  if (!ensureConfigured()) {
    console.error(
      "[push/web] not configured — missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY; skipping send",
    );
    return { ok: false, gone: false };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
    );
    return { ok: true, gone: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const reason = (err as { body?: string; message?: string }).body
      ?? (err as { message?: string }).message;
    const gone = statusCode === 404 || statusCode === 410;
    console.error(
      `[push/web] send failed status=${statusCode ?? "unknown"} gone=${gone} reason=${
        reason ?? "unknown"
      }`,
    );
    return {
      ok: false,
      gone,
      ...(statusCode !== undefined ? { status: statusCode } : {}),
      ...(reason ? { reason } : {}),
    };
  }
};
