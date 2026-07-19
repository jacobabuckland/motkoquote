import http2 from "node:http2";
import { createSign } from "node:crypto";
import type { PushPayload } from "@/lib/push/payload";

// Hand-rolled APNs (token-based auth) so we avoid a heavy native dependency.
// We sign an ES256 JWT with the .p8 key and post over HTTP/2 to Apple. The
// token is valid up to an hour; Apple rejects tokens younger than ~20 minutes
// on refresh, so we cache and reuse until it nears expiry.

export type ApnsResult = {
  ok: boolean;
  gone: boolean;
  status?: number;
  reason?: string;
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  host: string;
};

const getConfig = (): ApnsConfig | null => {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  // Stored with literal "\n" in env; restore real newlines for the PEM parser.
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!keyId || !teamId || !privateKey || !bundleId) return null;
  const host =
    process.env.APNS_ENV === "sandbox"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
  return { keyId, teamId, privateKey, bundleId, host };
};

const base64url = (input: Buffer | string): string =>
  (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

let cachedToken: { jwt: string; issuedAt: number } | null = null;

// Builds (or reuses) the provider JWT Apple expects in the authorization
// header. Refreshed every ~50 minutes to stay comfortably inside the 1h cap.
const getProviderToken = (config: ApnsConfig): string => {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.issuedAt < 3000) return cachedToken.jwt;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" });
  const jwt = `${signingInput}.${base64url(signature)}`;
  cachedToken = { jwt, issuedAt: now };
  return jwt;
};

// Delivers one payload to one device token. `threadId` groups a job's alerts in
// the iOS notification tray (mirrors the web push tag). Never throws; a dead or
// unregistered token resolves with gone: true so the caller prunes it.
export const sendApns = async (
  deviceToken: string,
  payload: PushPayload,
  threadId: string,
): Promise<ApnsResult> => {
  const config = getConfig();
  if (!config) {
    console.error(
      "[push/apns] not configured — missing APNS_KEY_ID/TEAM_ID/PRIVATE_KEY/BUNDLE_ID; skipping send",
    );
    return { ok: false, gone: false };
  }

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "thread-id": threadId,
    },
    url: payload.url,
    event: payload.event,
  });

  return new Promise<ApnsResult>((resolve) => {
    const client = http2.connect(config.host);
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };

    client.on("error", () => finish({ ok: false, gone: false }));

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${getProviderToken(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("error", () => finish({ ok: false, gone: false }));
    req.on("end", () => {
      if (status === 200) return finish({ ok: true, gone: false, status });
      // 410 = device no longer registered; BadDeviceToken/Unregistered in the
      // JSON body means the same for a still-open connection.
      const reason = (() => {
        try {
          return (JSON.parse(responseBody) as { reason?: string }).reason;
        } catch {
          return undefined;
        }
      })();
      const gone =
        status === 410 ||
        reason === "BadDeviceToken" ||
        reason === "Unregistered";
      // A wrong APNS_ENV (sandbox token hitting the prod gateway or vice versa)
      // surfaces as 400 BadDeviceToken here — the single most common cause of
      // "notifications silently don't arrive", so make it loud.
      console.error(
        `[push/apns] send failed status=${status} reason=${reason ?? "unknown"} env=${
          process.env.APNS_ENV === "sandbox" ? "sandbox" : "production"
        } token=${deviceToken.slice(0, 8)}… gone=${gone}`,
      );
      finish({ ok: false, gone, status, ...(reason ? { reason } : {}) });
    });

    req.end(body);
  });
};
