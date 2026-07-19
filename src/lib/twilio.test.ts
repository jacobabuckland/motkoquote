import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSmsCommand, validateTwilioSignature } from "@/lib/twilio";

// Reproduces Twilio's signing scheme so tests generate a valid signature the
// same way Twilio's servers do, then assert our validator accepts it.
const sign = (authToken: string, url: string, params: Record<string, string>) => {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
};

describe("validateTwilioSignature", () => {
  const token = "test-auth-token";
  const url = "https://motko.app/api/twilio/inbound";
  const params = { From: "+447446903343", Body: "STOP", To: "+447700900000" };

  it("accepts a correctly signed request", () => {
    const signature = sign(token, url, params);
    expect(validateTwilioSignature(token, url, params, signature)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(token, url, params);
    expect(
      validateTwilioSignature(token, url, { ...params, Body: "START" }, signature),
    ).toBe(false);
  });

  it("rejects the wrong auth token", () => {
    const signature = sign("someone-elses-token", url, params);
    expect(validateTwilioSignature(token, url, params, signature)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(validateTwilioSignature(token, url, params, "")).toBe(false);
  });
});

describe("parseSmsCommand", () => {
  it("treats STOP keywords as opt-out, case-insensitively", () => {
    for (const word of ["STOP", "stop", " Stop ", "UNSUBSCRIBE", "cancel", "QUIT"]) {
      expect(parseSmsCommand(word)).toBe("stop");
    }
  });

  it("treats START keywords as opt-in", () => {
    for (const word of ["START", "unstop", "YES"]) {
      expect(parseSmsCommand(word)).toBe("start");
    }
  });

  it("ignores an ordinary reply", () => {
    expect(parseSmsCommand("thanks, will pay tomorrow")).toBeNull();
    expect(parseSmsCommand("")).toBeNull();
  });
});
