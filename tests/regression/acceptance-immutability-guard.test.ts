import { describe, expect, it } from "vitest";
import {
  REGISTRY_FILES,
  classifyRegistryDiff,
} from "@/../scripts/ci/acceptance-immutability";

// This guard decides whether an acceptance-test edit is legitimate. A carve-out
// in a check of this kind is exactly where a check quietly stops catching the
// thing it exists for, so the abuse cases below matter more than the happy one.

const patch = (body: string): string =>
  [
    "diff --git a/tests/acceptance/99.test.ts b/tests/acceptance/99.test.ts",
    "index 1111111..2222222 100644",
    "--- a/tests/acceptance/99.test.ts",
    "+++ b/tests/acceptance/99.test.ts",
    "@@ -40,6 +40,7 @@",
    body,
  ].join("\n");

describe("what counts as registration", () => {
  it("allows adding a route entry", () => {
    const verdict = classifyRegistryDiff(
      patch(
        [
          " const CURRENT_PUBLIC_API_ROUTES = [",
          '+  "/api/guest/realtime-session",',
          '   "/api/quotes/[id]/pdf",',
        ].join("\n"),
      ),
    );
    expect(verdict.kind).toBe("registration");
  });

  it("allows a comment alongside the entry, so the reason can be recorded", () => {
    const verdict = classifyRegistryDiff(
      patch(
        [
          "+  // Mints a Realtime token for a guest. Reads and writes no table.",
          '+  "/api/guest/realtime-session",',
          '   "/api/quotes/[id]/pdf",',
        ].join("\n"),
      ),
    );
    expect(verdict.kind).toBe("registration");
  });

  it("allows the same entry in both places the file enumerates it", () => {
    // 99.test.ts lists the routes twice — the const and a duplicated literal
    // inside an assertion. Registering means adding to both.
    const verdict = classifyRegistryDiff(
      [
        "diff --git a/tests/acceptance/99.test.ts b/tests/acceptance/99.test.ts",
        "--- a/tests/acceptance/99.test.ts",
        "+++ b/tests/acceptance/99.test.ts",
        "@@ -40,6 +40,7 @@",
        '+  "/api/guest/realtime-session",',
        '   "/api/quotes/[id]/pdf",',
        "@@ -92,6 +93,7 @@",
        '+        "/api/guest/realtime-session",',
        '         "/api/quotes/[id]/pdf",',
      ].join("\n"),
    );
    expect(verdict.kind).toBe("registration");
  });
});

describe("what the carve-out must still refuse", () => {
  it("refuses a removal — an entry cannot be taken out of the registry's view", () => {
    const verdict = classifyRegistryDiff(
      patch(['-  "/api/stripe/webhook",', '   "/api/quotes/[id]/pdf",'].join("\n")),
    );
    expect(verdict.kind).toBe("violation");
    expect(verdict.kind === "violation" && verdict.reason).toMatch(/removes 1 line/);
  });

  it("refuses moving a route from public to protected (a delete plus an add)", () => {
    const verdict = classifyRegistryDiff(
      patch(
        [
          '-  "/api/guest/realtime-session",',
          "@@ -50,6 +50,7 @@",
          '+  "/api/guest/realtime-session",',
        ].join("\n"),
      ),
    );
    expect(verdict.kind).toBe("violation");
  });

  it("refuses weakening an assertion, even though it only adds lines", () => {
    // The failure mode this exists to stop: using the carve-out to edit the
    // machinery that reads the registry rather than the list it reads.
    const verdict = classifyRegistryDiff(
      patch(["+      if (process.env.CI) return;", "   expect(unclassified).toEqual([]);"].join("\n")),
    );
    expect(verdict.kind).toBe("violation");
    expect(verdict.kind === "violation" && verdict.reason).toMatch(/not registry entries/);
  });

  it("refuses an added entry smuggled onto a line carrying code", () => {
    const verdict = classifyRegistryDiff(
      patch(['+  "/api/x", ] as const; const IGNORED_ROUTES = ['].join("\n")),
    );
    expect(verdict.kind).toBe("violation");
  });

  it("refuses adding a whole new test or helper to the file", () => {
    const verdict = classifyRegistryDiff(
      patch(
        [
          '+  it("skips the check", () => {',
          "+    expect(true).toBe(true);",
          "+  });",
        ].join("\n"),
      ),
    );
    expect(verdict.kind).toBe("violation");
  });

  it("refuses a no-op edit that adds nothing", () => {
    const verdict = classifyRegistryDiff(
      patch(['   "/api/quotes/[id]/pdf",'].join("\n")),
    );
    expect(verdict.kind).toBe("violation");
  });

  it("does not mistake the +++/--- file headers for added or removed lines", () => {
    // A diff whose only "+"/"-" lines are the headers has no real change, and
    // must not read as a clean registration.
    const verdict = classifyRegistryDiff(
      [
        "diff --git a/tests/acceptance/99.test.ts b/tests/acceptance/99.test.ts",
        "--- a/tests/acceptance/99.test.ts",
        "+++ b/tests/acceptance/99.test.ts",
      ].join("\n"),
    );
    expect(verdict.kind).toBe("violation");
  });
});

describe("the registry allowlist", () => {
  it("names files explicitly rather than matching a pattern", () => {
    // A glob would let any future file opt itself out of the freeze by being
    // named to match. Widening this list is meant to be a reviewable decision.
    expect(REGISTRY_FILES).toEqual(["tests/acceptance/99.test.ts"]);
    for (const file of REGISTRY_FILES) {
      expect(file.startsWith("tests/acceptance/")).toBe(true);
      expect(file).not.toContain("*");
    }
  });
});
