# motko.co.uk Marketing Site

Static marketing site for motko, to be deployed to motko.co.uk (separate from the motko.app product).

## Structure

- `index.html` - Homepage with "Your first three jobs are free" messaging, and
  the **only App Store link in either codebase** — motko.app is held to zero App
  Store references by `tests/regression/app-store-link.test.ts`, so if the
  listing moves, `site/index.html` is the one line to change.
- `pricing.html` - Full pricing page with fee ladder and referral rewards
- `styles.css` - Basic styling for the marketing site

## Deployment

This site should be deployed to motko.co.uk using Vercel or similar static hosting.

Configure the deployment:
1. Set the root directory to `site/`
2. Deploy to motko.co.uk domain
3. No build step required (static HTML)

## Key Messaging

### Homepage
- "Your first three jobs are free" (exact number "three")
- No "free while in early access" or similar open-ended claims
- No "beta" used to imply pricing

### Pricing Page
The pricing page publishes the complete fee structure. **Every figure on it is
derived from `src/lib/pricing-facts.ts`, which in turn computes them by calling
`motkoFeePennies`.** Do not edit a number on `pricing.html` by hand — change the
ladder in `src/lib/motko-fee.ts` and update the page to match what
`tests/regression/pricing-copy.test.ts` then reports.

**One fee:**
- 0.3% of the first £5,000, 0.2% of the next £5,000, 0.15% above £10,000,
  minimum £2.00, **no maximum**
- **No payment-processing pass-through.** FEE-7 would have charged Stripe's
  cost through and was dropped on 31 Aug (#475); motko absorbs it. Do not
  reintroduce that claim without reviving the ticket first.

**Key points:**
- Charged on the job value **excluding VAT**
- Charged **per payment** — a job paid in stages is charged per stage
- Nothing charged until the contractor is paid
- The fee is fixed on the **payment** date, not the quote date
- motko is **not** VAT registered; fees are not VAT-inclusive

**Referral rewards:**
- 3 free jobs per referral who completes their first paid job
- After 5 successful referrals: 5 free jobs per referral
- Credits stack and accumulate

**Free job waiver rule:**
- A credit applies to **one payment**, not a whole job
- A credit waives up to £2.00 of the service fee; the rest is payable

## Deployment Sequencing

⚠️ **Important:** the site must never state a price the app does not display,
and vice versa. FEE-3 recorded this for the first reprice; FEE-9 inherits it,
and `tests/regression/pricing-copy.test.ts` now enforces it against
`motkoFeePennies` rather than trusting anyone to remember.

FEE-7's processing pass-through was **dropped** (#475), so this page no longer
describes one and there is no longer a code dependency holding the site back.

The free-job waiver copy states the £2.00 cap, which is what
`planPaidJobSettlement` does today. **FEE-11 (#466) removes that cap.** When it
lands, this page and `src/lib/fee-copy.ts` change together — a regression test
pins them to the code, so it will fail rather than drift.

Still outstanding before this page goes live, both human rather than technical:
the founder notice email to existing contractors, and the accountant's sign-off
on the VAT wording. Both are recorded on #468.
