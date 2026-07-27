import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { buildHostedPaymentPageUrl, checkSigningKey } from "@/lib/truelayer";

describe("buildHostedPaymentPageUrl", () => {
  const payment = { id: "pay-123", resourceToken: "tok-abc" };

  it("builds the sandbox HPP URL with hash params and encoded return_uri", () => {
    const url = buildHostedPaymentPageUrl(
      "sandbox",
      payment,
      "https://motko.app/i/inv-1/paid",
    );
    expect(url).toBe(
      "https://payment.truelayer-sandbox.com/payments#payment_id=pay-123" +
        "&resource_token=tok-abc" +
        "&return_uri=https%3A%2F%2Fmotko.app%2Fi%2Finv-1%2Fpaid",
    );
  });

  it("uses the live host in live mode", () => {
    const url = buildHostedPaymentPageUrl("live", payment, "https://motko.app/done");
    expect(url.startsWith("https://payment.truelayer.com/payments#")).toBe(true);
  });
});

describe("checkSigningKey — request-signing self-check (M/#payment)", () => {
  const OLD = {
    kid: process.env.TRUELAYER_SIGNING_KID,
    key: process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64,
  };
  const setKey = (pem: string | null) => {
    if (pem === null) {
      delete process.env.TRUELAYER_SIGNING_KID;
      delete process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64;
      return;
    }
    process.env.TRUELAYER_SIGNING_KID = "kid-1";
    process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64 = Buffer.from(pem, "utf8").toString("base64");
  };
  const ecPem = (namedCurve: string) =>
    generateKeyPairSync("ec", { namedCurve, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;

  afterEach(() => {
    if (OLD.kid === undefined) delete process.env.TRUELAYER_SIGNING_KID;
    else process.env.TRUELAYER_SIGNING_KID = OLD.kid;
    if (OLD.key === undefined) delete process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64;
    else process.env.TRUELAYER_SIGNING_PRIVATE_KEY_B64 = OLD.key;
  });

  it("passes for a valid EC P-521 (secp521r1) key — the ES512 curve", () => {
    setKey(ecPem("secp521r1"));
    expect(checkSigningKey()).toEqual({ ok: true, keyType: "ec", namedCurve: "secp521r1", isP521: true });
  });

  it("flags an EC key on the wrong curve (isP521 false)", () => {
    setKey(ecPem("prime256v1"));
    const result = checkSigningKey();
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ isP521: false });
  });

  it("fails when the PEM is malformed (never throws)", () => {
    setKey("-----BEGIN EC PRIVATE KEY-----\nnot-base64-der\n-----END EC PRIVATE KEY-----");
    const result = checkSigningKey();
    expect(result.ok).toBe(false);
  });

  it("reports 'signing env not set' when unconfigured", () => {
    setKey(null);
    expect(checkSigningKey()).toEqual({ ok: false, reason: "signing env not set" });
  });
});
