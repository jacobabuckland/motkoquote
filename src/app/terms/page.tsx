/**
 * Contractor terms.
 *
 * FEE-10 requires the reversal rules to be written down, and its reasoning is
 * the reason this page exists at all: "A non-refundable fee that is not written
 * down is not enforceable and, more importantly, is not fair." There were no
 * contractor terms in this repository before this file — the fee rules lived in
 * a settlement function, a marketing page and four bits of in-app copy, none of
 * which a contractor can point at.
 *
 * The fee clauses are rendered from `REVERSAL_CLAUSE` rather than typed here,
 * so the page and `planSettlementReversal` cannot state different rules. FEE-9
 * is the ticket about a published claim drifting from the code that charges it;
 * this is the same discipline applied to the clause instead of the price.
 */

import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { resolveAppHomeHref } from "@/lib/app-home";
import {
  CANCELLATION_SENTENCE,
  FEE_SCHEDULE_SENTENCE,
  REPRICE_RULE,
  SUBSCRIPTION_SENTENCE,
} from "@/lib/pricing-facts";
import { REVERSAL_CLAUSE } from "@/lib/settlement-reversal";

export const metadata: Metadata = {
  title: "Contractor Terms — Motko",
  description: "The terms that apply to contractors using Motko, including how fees are charged.",
};

export default async function TermsPage() {
  const backHref = await resolveAppHomeHref();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref={backHref} title="Motko" />
      <main className="flex flex-1 justify-center p-6">
        <article className="w-full max-w-2xl space-y-6 text-sm leading-relaxed text-foreground">
          <div>
            <h1 className="text-2xl font-semibold">Contractor Terms</h1>
            <p className="mt-1 text-text-secondary">Last updated 7 September 2026</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What Motko charges</h2>
            {/*
              TWO charges, and only two: the monthly subscription and the
              per-payment transaction fee. This comment used to say "one fee,
              because there is only one" — true when it was written, and left
              standing through SUB-1 shipping the subscription.

              There is still NO processing pass-through. FEE-7 would have passed
              Stripe's cost through to the contractor and was dropped on 31 Aug
              (#475), so motko absorbs it. A clause describing a processing
              charge would be a term for something nobody is billed for.
            */}
            <p>{SUBSCRIPTION_SENTENCE}</p>
            {/*
              Rendered from the constant, not typed here. This paragraph used
              to state the retired marginal ladder — "0.3% of the first £5,000
              … a £2.00 minimum and no maximum" — every clause of which SUB-3
              made false, and nothing caught it: the page renders REVERSAL_CLAUSE
              from a constant so the RULES cannot drift from the code, but the
              PRICE was typed in by hand and held to nothing.
            */}
            <p>{FEE_SCHEDULE_SENTENCE}</p>
            <p>
              It is charged on the job value excluding VAT, and per payment — a
              job paid in stages is charged on each stage. Nothing is charged
              until you have been paid.
            </p>
            <p>{REPRICE_RULE}</p>
            <p>
              Motko is not currently registered for VAT, so no VAT is included
              in or added to this fee. If that changes we will tell you before
              it takes effect.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Cancelling</h2>
            {/*
              SUB-6 (#666) shipped cancellation on 7 Sep and this section did
              not exist, so the app did something the terms did not describe.
              An absence rather than a falsehood, which is why it survived — but
              a feature a contractor can use today with no term behind it is the
              harder position to defend, not the easier one.
            */}
            <p>{CANCELLATION_SENTENCE}</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Refunds and reversals</h2>
            <p>{REVERSAL_CLAUSE.serviceFee}</p>
            <p>{REVERSAL_CLAUSE.partialRefund}</p>
            <p>{REVERSAL_CLAUSE.freeCredit}</p>
            <p>
              A payment reversed before it settled is different: no fee was
              charged, so there is nothing to keep and nothing is owed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Free jobs and referrals</h2>
            <p>
              Your first three jobs are free: a credit is applied to one
              payment, not to a whole job, so a job paid in stages uses one
              credit against one stage and the remaining stages are charged
              normally. A credit covers the whole fee on the payment it is
              applied to, whatever the job is worth.
            </p>
            <p>
              Referring another tradesperson earns free jobs when they complete
              their first paid job. Credits stack and do not expire, and you can
              hold up to 10 at a time — a reward that would take you above that
              is reduced to the room you have left.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your work and your customers</h2>
            <p>
              Motko provides the tools — quoting, contracts, invoicing and
              payment collection. The contract for the work itself is between
              you and your customer. Motko is not a party to it, does not
              perform the work, and does not guarantee that a customer pays.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Questions</h2>
            <p>
              Anything about fees, a specific charge, or these terms:{" "}
              <a className="underline" href="mailto:hello@motko.app">
                hello@motko.app
              </a>
              .
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
