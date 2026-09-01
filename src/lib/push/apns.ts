import http2 from "node:http2";
import { createSign } from "node:crypto";
import type { PushPayload } from "@/lib/push/payload";

// Hand-rolled APNs (token-based auth) so we avoid a heavy native dependency.
// We sign an ES256 JWT with the .p8 key and post over HTTP/2 to Apple. The
// token is valid up to an hour; Apple rejects tokens younger than ~20 minutes
// on refresh, so we cache and reuse until it nears expiry.
//
// APNs has TWO gateways and a device token belongs to exactly one of them. A
// build signed with a development profile (running from Xcode) gets a SANDBOX
// token; a downloaded build — TestFlight or App Store — gets a PRODUCTION one.
// Send either to the other's gateway and Apple answers 400 BadDeviceToken.
//
// This used to be one global `APNS_ENV`, so the two could not both work: with
// it set to sandbox every real download silently failed, and clearing it would
// have broken every Xcode build instead. Worse, `index.ts` reads BadDeviceToken
// as "this device is gone" and DELETES the subscription — so a contractor on a
// downloaded build enabled notifications, the first send bounced, their row was
// removed, Settings went back to "No devices registered yet", and enabling it
// again just repeated the loop.
//
// So the gateway is now resolved per token rather than per deployment: try the
// likely one, and on BadDeviceToken — the only reason that means "wrong
// gateway" — try the other before believing it. A token is only reported gone
// when BOTH gateways reject it, which is the condition that actually means it.

export type ApnsResult = {
  ok: boolean;
  /**
   * The token is dead and the subscription should be pruned.
   *
   * Only true when the gateway that CAN know says so — a 410/Unregistered, or a
   * BadDeviceToken from both gateways. A BadDeviceToken from one is a routing
   * fact, not a device fact.
   */
  gone: boolean;
  status?: number;
  reason?: string;
  /** Which gateway produced this result, absent when none was reached. */
  env?: ApnsEnv;
};

export type ApnsEnv = "production" | "sandbox";

export const APNS_HOST: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  /** Which gateway to TRY FIRST. Not a restriction — see attemptOrder. */
  preferred: ApnsEnv;
};

const getConfig = (): ApnsConfig | null => {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  // Stored with literal "\n" in env; restore real newlines for the PEM parser.
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!keyId || !teamId || !privateKey || !bundleId) return null;
  // APNS_ENV now only orders the attempts; it can no longer strand a whole
  // class of device. Production first by default because that is every real
  // download; set it to sandbox on a dev deployment to save the extra hop.
  const preferred: ApnsEnv =
    process.env.APNS_ENV === "sandbox" ? "sandbox" : "production";
  return { keyId, teamId, privateKey, bundleId, preferred };
};

/**
 * The gateway each token was last delivered through.
 *
 * A token cannot change environment — it is issued by one and only ever valid
 * there — so a hit here is durable for the life of the process. Purely a way to
 * skip the wasted first attempt on repeat sends; losing it on a cold start
 * costs one extra request, never a delivery.
 *
 * Deliberately NOT a database column. Persisting it would mean a migration on
 * `push_subscriptions`, and the schema-before-code rule makes that two PRs and
 * a production apply to buy a saving of one HTTP request per cold token.
 */
const resolvedEnv = new Map<string, ApnsEnv>();

/** Both gateways, likeliest first: what we know, else what is configured. */
const attemptOrder = (deviceToken: string, config: ApnsConfig): ApnsEnv[] => {
  const first = resolvedEnv.get(deviceToken) ?? config.preferred;
  return first === "production" ? ["production", "sandbox"] : ["sandbox", "production"];
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

// One POST to one gateway. The retry policy lives in sendApns; this is only
// the request.
const postOnce = async (
  env: ApnsEnv,
  deviceToken: string,
  payload: PushPayload,
  threadId: string,
  config: ApnsConfig,
): Promise<ApnsResult> => {
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
    const client = http2.connect(APNS_HOST[env]);
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
      if (status === 200) return finish({ ok: true, gone: false, status, env });
      const reason = (() => {
        try {
          return (JSON.parse(responseBody) as { reason?: string }).reason;
        } catch {
          return undefined;
        }
      })();
      // `gone` is decided by sendApns, never here: a BadDeviceToken from ONE
      // gateway is the ordinary signature of the other gateway's token, and
      // treating it as gone at this level is what was deleting live devices.
      // 410 Unregistered is different — only the CORRECT gateway can say the
      // app was uninstalled, so that one is conclusive on its own.
      finish({
        ok: false,
        gone: status === 410 || reason === "Unregistered",
        status,
        env,
        ...(reason ? { reason } : {}),
      });
    });

    req.end(body);
  });
};

/**
 * Delivers one payload to one device token, finding the right gateway itself.
 *
 * `threadId` groups a job's alerts in the iOS notification tray (mirrors the
 * web push tag). Never throws; a token both gateways reject resolves with
 * gone: true so the caller prunes it.
 */
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

  const order = attemptOrder(deviceToken, config);
  let last: ApnsResult = { ok: false, gone: false };

  for (const env of order) {
    const result = await postOnce(env, deviceToken, payload, threadId, config);
    if (result.ok) {
      resolvedEnv.set(deviceToken, env);
      return result;
    }
    last = result;
    // BadDeviceToken is the ONE reason worth asking the other gateway about:
    // it is exactly what Apple says when a token is valid, but not here.
    // Anything else — a 410, a 429, a 500, a transport failure — is about this
    // token or this moment, and the other gateway has nothing to add.
    if (result.reason !== "BadDeviceToken") break;
  }

  const bothRejected =
    order.length > 1 && last.reason === "BadDeviceToken";
  if (bothRejected) resolvedEnv.delete(deviceToken);

  console.error(
    `[push/apns] send failed status=${last.status ?? 0} reason=${last.reason ?? "unknown"} ` +
      `tried=${order.join(",")} token=${deviceToken.slice(0, 8)}… ` +
      `gone=${last.gone || bothRejected}`,
  );

  return { ...last, gone: last.gone || bothRejected };
};
