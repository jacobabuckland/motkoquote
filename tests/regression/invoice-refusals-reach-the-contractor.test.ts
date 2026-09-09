import { describe, expect, it } from "vitest";
import { actionableMessage } from "@/lib/actionable-error";
import {
  canRaiseFinalInvoice,
  deriveInvoiceAmount,
  type ExistingInvoice,
  type QuoteContract,
} from "@/lib/invoice-amount";

/**
 * Every refusal `deriveInvoiceAmount` authors must survive a production build.
 *
 * On 9 Sep a trade raised a final invoice on motko.app and was shown "An error
 * occurred in the server components render. The specific message is omitted in
 * production builds…". The guard that fired was right and its wording was good:
 *
 *   "Mark the work complete before raising a final invoice. Until then you can
 *    raise a deposit invoice."
 *
 * They never saw it, so a correct refusal read as the app being broken, and it
 * blocked the whole get-paid path (Sentry JAVASCRIPT-NEXTJS-B). The cause was
 * `throw new Error(...)`: React redacts the message of any error a Server
 * Action rejects with, and only `error.digest` survives. `actionableError`
 * stamps the message there; a bare Error carries nothing.
 *
 * WHY THIS TEST ASSERTS THROUGH A REDACTED TWIN RATHER THAN ON `err.message`.
 * Nothing redacts under vitest, so `err.message` holds the authored text with
 * or without the fix and an assertion on it passes against the defect. The only
 * way to test the thing that actually broke is to rebuild the error the way
 * React's Flight client hands it to the browser — message replaced, digest
 * copied verbatim — and read it back through the helper the call site uses.
 */

// React's production stand-in, quoted rather than imported: REDACTED_NOTICE is
// private to actionable-error.ts, and pinning the real sentence here is what
// makes this a test of production behaviour rather than of our own constant.
const REACT_REDACTION =
  "An error occurred in the Server Components render. The specific message is " +
  "omitted in production builds to avoid leaking sensitive details.";

/** The error as the browser receives it: message gone, digest intact. */
const asProductionWouldDeliver = (err: unknown): Error => {
  const digest = (err as Error & { digest?: unknown }).digest;
  return Object.assign(new Error(REACT_REDACTION), { digest });
};

const capture = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected deriveInvoiceAmount to refuse, but it returned");
};

const noInvoices: ExistingInvoice[] = [];
const noContracts: QuoteContract[] = [];
const halfDeposit: QuoteContract[] = [{ deposit_pct: 50, status: "signed" }];
const done = { workCompletedAt: "2026-09-09T10:00:00.000Z" };
const notDone = { workCompletedAt: null };

// Every refusal the function can produce, with the exact sentence it authors.
const refusals: { name: string; run: () => unknown; message: string }[] = [
  {
    name: "final before the work is marked complete",
    run: () => deriveInvoiceAmount("final", 1000, noInvoices, halfDeposit, notDone),
    message:
      "Mark the work complete before raising a final invoice. Until then you can raise a deposit invoice.",
  },
  {
    name: "a second deposit",
    run: () =>
      deriveInvoiceAmount(
        "deposit",
        1000,
        [{ amount: 500, invoice_type: "deposit" }],
        halfDeposit,
        notDone,
      ),
    message: "A deposit invoice has already been raised for this quote.",
  },
  {
    name: "a deposit with no percentage set",
    run: () => deriveInvoiceAmount("deposit", 1000, noInvoices, noContracts, notDone),
    message: "Set a deposit percentage on the contract before raising a deposit invoice.",
  },
  {
    name: "a deposit that works out to nothing",
    run: () =>
      deriveInvoiceAmount(
        "deposit",
        1000,
        noInvoices,
        [{ deposit_pct: 0, status: "signed" }],
        notDone,
      ),
    message: "The deposit works out to nothing to invoice.",
  },
  {
    name: "a deposit that would exceed the quote total",
    run: () =>
      deriveInvoiceAmount(
        "deposit",
        100,
        [{ amount: 90, invoice_type: "materials" }],
        halfDeposit,
        notDone,
      ),
    message: "That would invoice more than the quote total.",
  },
  {
    name: "a final on a quote already fully invoiced",
    run: () =>
      deriveInvoiceAmount(
        "final",
        1000,
        [{ amount: 1000, invoice_type: "deposit" }],
        halfDeposit,
        done,
      ),
    message: "This quote is already fully invoiced.",
  },
];

describe("invoice refusals reach the contractor in production", () => {
  for (const refusal of refusals) {
    it(`states why it refused: ${refusal.name}`, () => {
      const thrown = capture(refusal.run);
      const delivered = asProductionWouldDeliver(thrown);

      // The assertion that fails against `throw new Error(...)`: with no digest
      // the redacted twin carries only React's notice, and actionableMessage
      // correctly returns null rather than showing a description of a message.
      expect(actionableMessage(delivered)).toBe(refusal.message);
    });
  }

  it("covers every refusal the function can produce", () => {
    // Guards the list above against a new refusal being added with a bare
    // Error and no test — the failure mode this whole file exists for.
    const source = deriveInvoiceAmount.toString();
    const thrownCount = (source.match(/throw /g) ?? []).length;
    expect(thrownCount).toBe(refusals.length);
  });
});

/**
 * What a surface may OFFER must match what the server will ACCEPT.
 *
 * The dashboard rendered the invoice form — whose type defaults to "final" —
 * for every accepted quote, while the server refused a final invoice on any job
 * without work_completed_at. The completion control lived only on the job page,
 * and the card neither showed it nor linked to it, so the trade was one tap from
 * a refusal they could not satisfy from where they were standing. Production
 * agreed: 63 jobs, none completed, and no final invoice raised since the guard
 * shipped.
 *
 * Hiding a CTA is not a gate and this does not pretend otherwise — the server
 * still decides. This pins the weaker but load-bearing property: the predicate a
 * surface asks and the condition the server enforces cannot drift apart.
 */
describe("what the dashboard offers matches what the server accepts", () => {
  const anyQuote = 1000;
  const noInvoicesYet: ExistingInvoice[] = [];
  const withDeposit: QuoteContract[] = [{ deposit_pct: 50, status: "signed" }];

  const finalIsRefused = (job: { workCompletedAt: string | null }): boolean => {
    try {
      deriveInvoiceAmount("final", anyQuote, noInvoicesYet, withDeposit, job);
      return false;
    } catch {
      return true;
    }
  };

  for (const job of [
    { workCompletedAt: null },
    { workCompletedAt: "2026-09-09T10:00:00.000Z" },
  ]) {
    it(`agrees for workCompletedAt = ${job.workCompletedAt ?? "null"}`, () => {
      expect(canRaiseFinalInvoice(job)).toBe(!finalIsRefused(job));
    });
  }

  it("refuses a job that was never marked complete", () => {
    // The exact production state: 63 jobs, every one of them this shape.
    expect(canRaiseFinalInvoice({ workCompletedAt: null })).toBe(false);
  });
});
