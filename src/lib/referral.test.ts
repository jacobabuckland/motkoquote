import { describe, expect, it } from "vitest";
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  extractReferralCode,
  generateReferralCode,
  isSelfReferral,
  normalizeReferralCode,
  selfReferralSignals,
} from "@/lib/referral";

describe("generateReferralCode", () => {
  it("produces a code of the fixed length using only the unambiguous alphabet", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    for (const char of code) {
      expect(REFERRAL_CODE_ALPHABET).toContain(char);
    }
  });

  it("is deterministic given an injected RNG", () => {
    // random() always 0 -> first alphabet char ('A') repeated.
    expect(generateReferralCode(() => 0)).toBe("AAAAAA");
    // random() near 1 -> last alphabet char ('9') repeated.
    expect(generateReferralCode(() => 0.999999)).toBe("999999");
  });

  it("never contains the ambiguous characters I, O, 0 or 1", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateReferralCode()).not.toMatch(/[IO01]/);
    }
  });
});

describe("normalizeReferralCode", () => {
  it("upper-cases and strips spaces and hyphens", () => {
    expect(normalizeReferralCode(" dan-4k2 ")).toBe("DAN4K2");
    expect(normalizeReferralCode("da n4k2")).toBe("DAN4K2");
  });

  it("rejects wrong length", () => {
    expect(normalizeReferralCode("DAN4K")).toBeNull();
    expect(normalizeReferralCode("DAN4K23")).toBeNull();
  });

  it("rejects characters outside the alphabet (incl. ambiguous ones)", () => {
    expect(normalizeReferralCode("DAN4K0")).toBeNull(); // 0 not in alphabet
    expect(normalizeReferralCode("DAN4K!")).toBeNull();
  });
});

describe("extractReferralCode", () => {
  it("reads a code straight through", () => {
    expect(extractReferralCode("DAN4K2")).toBe("DAN4K2");
  });

  it("pulls the code out of a share link", () => {
    expect(extractReferralCode("https://motko.app/join?ref=DAN4K2")).toBe("DAN4K2");
    expect(extractReferralCode("motko.app/join?utm=x&ref=dan4k2")).toBe("DAN4K2");
  });

  it("returns null when there is no valid code", () => {
    expect(extractReferralCode("https://motko.app/join")).toBeNull();
    expect(extractReferralCode("")).toBeNull();
  });
});

describe("selfReferralSignals / isSelfReferral", () => {
  it("flags a shared email regardless of case and whitespace", () => {
    const signals = selfReferralSignals(
      { email: "Dan@Trade.co.uk" },
      { email: " dan@trade.co.uk " },
    );
    expect(signals).toEqual(["email"]);
    expect(isSelfReferral({ email: "a@b.com" }, { email: "a@b.com" })).toBe(true);
  });

  it("flags a shared phone across different written formats", () => {
    expect(
      selfReferralSignals({ phone: "07123 456789" }, { phone: "+447123456789" }),
    ).toEqual(["phone"]);
  });

  it("flags a shared bank account ignoring spacing", () => {
    expect(
      selfReferralSignals({ bankAccount: "12-34-56 12345678" }, { bankAccount: "123456 12345678" }),
    ).toEqual(["bank_account"]);
  });

  it("returns multiple signals when several identities match", () => {
    const signals = selfReferralSignals(
      { email: "a@b.com", phone: "07123456789" },
      { email: "a@b.com", phone: "07123456789" },
    );
    expect(signals).toEqual(["email", "phone"]);
  });

  it("does not flag distinct people", () => {
    expect(
      isSelfReferral(
        { email: "dan@trade.co.uk", phone: "07123456789" },
        { email: "sam@trade.co.uk", phone: "07999888777" },
      ),
    ).toBe(false);
  });

  it("does not flag on absent fields (missing is not a match)", () => {
    expect(isSelfReferral({ email: null }, { email: null })).toBe(false);
    expect(isSelfReferral({}, {})).toBe(false);
    expect(isSelfReferral({ phone: "" }, { phone: "" })).toBe(false);
  });
});
