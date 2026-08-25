/**
 * @vitest-environment happy-dom
 */

// A referral code used to survive exactly one page load.
//
// src/app/signup/page.tsx read it at SUBMIT time off window.location.href, and
// nothing anywhere else in src/ read or wrote `ref`. So the code was lost by
// any of three ordinary journeys: a detour to /login and back, a reload, or —
// the one that matters most, because the product is an app shared trade to
// trade — installing the iOS app and signing up there, where the shell loads
// motko.app and the query string never arrives at all.
//
// Redemption itself is downstream and unchanged: the code rides in
// user_metadata and provisionNewContractor redeems it when the contractor row
// is created.
import { beforeEach, describe, expect, it } from "vitest";
import {
  REFERRAL_STORAGE_KEY,
  captureReferralCode,
  forgetReferralCode,
  recallReferralCode,
  rememberReferralCode,
} from "@/lib/referral-capture";

beforeEach(() => {
  window.localStorage.clear();
});

describe("capturing the code on arrival", () => {
  it("takes it from the link the referee landed on", () => {
    expect(captureReferralCode("https://motko.app/signup?ref=DAN4K2")).toBe(
      "DAN4K2",
    );
  });

  it("survives a detour away from the signup page and back", () => {
    // Land on the link…
    captureReferralCode("https://motko.app/signup?ref=DAN4K2");
    // …tap "Sign in", realise you have no account, come back with a bare URL.
    expect(
      captureReferralCode("https://motko.app/signup"),
      "the return trip carries no ?ref= — this is the journey that lost it",
    ).toBe("DAN4K2");
  });

  it("survives arriving somewhere else entirely afterwards", () => {
    // The app shell loads https://motko.app, not the referral URL. Signing up
    // inside the app has to find the code from the earlier browser visit.
    captureReferralCode("https://motko.app/join?ref=DAN4K2");
    expect(captureReferralCode("https://motko.app/")).toBe("DAN4K2");
  });

  it("prefers a fresh link over one held from before", () => {
    // Someone arriving on a new link is redeeming that link.
    captureReferralCode("https://motko.app/signup?ref=DAN4K2");
    expect(captureReferralCode("https://motko.app/signup?ref=QRS789")).toBe(
      "QRS789",
    );
    expect(recallReferralCode()).toBe("QRS789");
  });

  it("returns null when there has never been a code", () => {
    expect(captureReferralCode("https://motko.app/signup")).toBeNull();
  });

  it("does not store something that cannot be a code", () => {
    // Normalizing at the boundary means redemption fails cleanly later rather
    // than matching nothing with no explanation.
    expect(rememberReferralCode("https://motko.app/signup?ref=NOT-A-CODE-AT-ALL")).toBeNull();
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull();
  });
});

describe("normalizing what a trade typed", () => {
  // The alphabet deliberately drops I/O/0/1 because codes are read aloud and
  // typed off a screen, so the tolerance has to be real.
  it("accepts a bare code, lower case, with spacing", () => {
    expect(rememberReferralCode("  dan 4k2 ")).toBe("DAN4K2");
  });

  it("accepts a code written with a hyphen", () => {
    expect(rememberReferralCode("DAN-4K2")).toBe("DAN4K2");
  });
});

describe("letting go of the code", () => {
  it("is forgotten once signup has consumed it", () => {
    // Otherwise the next person to sign up on this device is silently
    // attributed to the first person's referrer.
    captureReferralCode("https://motko.app/signup?ref=DAN4K2");
    forgetReferralCode();
    expect(recallReferralCode()).toBeNull();
  });
});

describe("when storage is unavailable", () => {
  it("does not throw, and does not block signup", () => {
    // localStorage throws outright in a Safari private window and in some
    // embedded web views. Losing a referral is recoverable; failing the signup
    // form is not.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });

    try {
      expect(() =>
        captureReferralCode("https://motko.app/signup?ref=DAN4K2"),
      ).not.toThrow();
      expect(() => recallReferralCode()).not.toThrow();
      expect(() => forgetReferralCode()).not.toThrow();
      // The code still comes back for THIS page load, which is all the old
      // behaviour ever managed anyway.
      expect(captureReferralCode("https://motko.app/signup?ref=DAN4K2")).toBe(
        "DAN4K2",
      );
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});
