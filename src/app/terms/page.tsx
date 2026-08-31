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
            <p className="mt-1 text-text-secondary">Last updated 31 August 2026</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What Motko charges</h2>
            <p>
              Two charges apply to a payment, and they are separate. Payment
              processing is what the payment provider costs, passed through at
              cost and capped at £5.00 per payment — Motko does not mark it up
              and keeps no part of it. The Motko service fee is a percentage of
              the job: 0.3% of the first £5,000, 0.2% of the next £5,000, and
              0.15% above £10,000, with a £2.00 minimum and no maximum.
            </p>
            <p>
              Both are charged on the job value excluding VAT, and per payment —
              a job paid in stages is charged on each stage. Nothing is charged
              until you have been paid.
            </p>
            <p>
              The fee is worked out when your customer pays, not when you send
              the quote. A quote sent before a price change is charged at the
              price in force on the day it is paid.
            </p>
            <p>
              Motko is not currently registered for VAT, so no VAT is included
              in or added to these fees. If that changes we will tell you before
              it takes effect.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Refunds and reversals</h2>
            <p>{REVERSAL_CLAUSE.serviceFee}</p>
            <p>{REVERSAL_CLAUSE.processingFee}</p>
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
              normally. A credit covers the standard £2.00 service fee; where
              the service fee is more than that, you pay the difference above
              £2.00. Payment processing is charged on a free job as normal.
            </p>
            <p>
              Referring another tradesperson earns free jobs when they complete
              their first paid job. Credits stack and do not expire.
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
