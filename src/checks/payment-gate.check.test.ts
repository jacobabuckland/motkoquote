import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Checker rule (CONN-1): every Stripe payment intent is created behind the
// readiness gate. A contractor who has not finished Connect onboarding cannot
// be paid through the rail, and the only thing standing between that rule and a
// charge is that exactly ONE route builds payment intents — the one that calls
// canAcceptStripePayment first.
//
// This lives here rather than in tests/acceptance/599.test.tsx, where it was
// first written as a `git grep` shelled out through execSync. Two reasons, and
// the second is the substantive one:
//
//   1. AGENTS.md forbids an acceptance test asserting on source text, and a
//      read performed by git is still a read. That test was frozen the moment
//      it was committed, so no correct refactor could ever have been made to it.
//
//   2. The claim quantifies over routes that DO NOT EXIST YET. No behavioural
//      test can cover "and no future route does this either" — that is what the
//      standing-checker layer is for, and as a check it runs on every branch
//      rather than once for the item that introduced it.
//
// Reading source is the established idiom here; money-source.check.test.ts does
// the same thing for client-supplied amounts.
//
// If this fails, do NOT widen the allowlist to make it pass. A second route
// creating payment intents is the defect it exists to name — route the charge
// through create-payment-intent, or gate the new route the same way.

const root = (p: string) => join(process.cwd(), p);

/** The one route permitted to create a Stripe payment intent. */
const GATED_ROUTE = "src/app/api/stripe/create-payment-intent/route.ts";

/** Where createStripePayment is defined, and so names itself. */
const PAYMENT_MODULE = "src/lib/stripe-payments.ts";

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

/** Every non-test source file under a directory, as repo-relative paths. */
const sourcesUnder = (dir: string): string[] =>
  walk(root(dir)).map((f) => relative(process.cwd(), f));

describe("no code path bypasses the Stripe readiness gate", () => {
  it("createStripePayment is called only from the gated route", () => {
    const callers = sourcesUnder("src")
      .filter((f) => f !== PAYMENT_MODULE)
      .filter((f) => /\bcreateStripePayment\s*\(/.test(readFileSync(root(f), "utf8")));

    expect(callers).toEqual([GATED_ROUTE]);
  });

  it("no API route builds a payment intent directly", () => {
    // The gate is a property of the route, so a second route reaching past
    // createStripePayment to the Stripe SDK would be ungated by construction.
    const direct = sourcesUnder("src/app/api")
      .filter((f) => f !== GATED_ROUTE)
      .filter((f) =>
        /\bpaymentIntents\s*\.\s*create\b/.test(readFileSync(root(f), "utf8")),
      );

    expect(direct).toEqual([]);
  });

  it("the gated route consults canAcceptStripePayment", () => {
    // Without this the two assertions above are satisfied by a route that
    // creates payment intents and gates nothing.
    expect(readFileSync(root(GATED_ROUTE), "utf8")).toMatch(
      /\bcanAcceptStripePayment\s*\(/,
    );
  });
});
