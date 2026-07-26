import { describe, it, expect, vi, beforeEach } from "vitest";

// L2: a STOP/START must be a single atomic jsonb merge in the database, never a
// read-modify-write in JS (which lost concurrent updates and missed rows added
// after the SELECT). These tests assert the route calls the set_sms_opt_out RPC
// with the normalised number and correct flag — and does nothing else to the
// customers table.
const h = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
  from: vi.fn(),
  validate: vi.fn(() => true),
  parse: vi.fn((body: string) => (body.trim().toLowerCase() === "stop" ? "stop" : "start")),
  normalize: vi.fn((raw: string) => raw),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: h.rpc, from: h.from }),
}));
vi.mock("@/lib/twilio", () => ({
  validateTwilioSignature: h.validate,
  parseSmsCommand: h.parse,
}));
vi.mock("@/lib/phone", () => ({ normalizeUkPhone: h.normalize }));

import { POST } from "@/app/api/twilio/inbound/route";

const requestWith = (body: string, from: string) =>
  ({
    formData: async () => {
      const fd = new FormData();
      fd.set("Body", body);
      fd.set("From", from);
      return fd;
    },
    headers: { get: () => "sig" },
  }) as never;

describe("twilio inbound — atomic opt-out (L2)", () => {
  beforeEach(() => {
    h.rpc.mockClear();
    h.from.mockClear();
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.NEXT_PUBLIC_APP_URL = "https://motko.app";
  });

  it("calls set_sms_opt_out with opt_out=true on STOP and never touches customers directly", async () => {
    await POST(requestWith("STOP", "+447700900123"));
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("set_sms_opt_out", {
      p_phone: "+447700900123",
      p_opt_out: true,
    });
    // No read-modify-write path: the customers table is never queried/updated.
    expect(h.from).not.toHaveBeenCalled();
  });

  it("calls set_sms_opt_out with opt_out=false on START", async () => {
    await POST(requestWith("START", "+447700900123"));
    expect(h.rpc).toHaveBeenCalledWith("set_sms_opt_out", {
      p_phone: "+447700900123",
      p_opt_out: false,
    });
  });
});
