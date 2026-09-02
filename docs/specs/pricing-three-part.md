# Three-part pricing — working-backwards spec

**Status:** specified, not built. Decided by Jacob, 2 Sep 2026.

Supersedes the FEE-6 marginal ladder (0.3 / 0.2 / 0.15%) and reverses the FEE-7
drop (#475), which had motko absorbing the payment provider's cost.

---

## The model

Three charges, and a contractor only ever meets them once their customer has
paid:

1. **Payment processing — passed through at the provider's cost.**
   0.5% + £0.20 per payment, capped at £5.00. motko adds nothing to it and
   keeps nothing from it.
2. **motko service fee — 0.4%** of the first £5,000 of a job, **0.3%** on
   everything above. Marginal, as today: each rate applies only to the part of
   the job inside its band.
3. **£9.99 per month**, beginning once the free-job allowance is exhausted.

**A free job charges processing only** — no service fee, no subscription
accrual.

### Why this shape

The model it replaces was structurally loss-making. Service fee minus the
processing cost motko was absorbing:

| Job value | Service fee (old) | Processing | motko netted |
|---|---|---|---|
| £500 | £2.00 | £2.70 | **−£0.70** |
| £1,000 | £3.00 | £5.00 | **−£2.00** |
| £1,667 | £5.00 | £5.00 | £0.00 |
| £5,000 | £15.00 | £5.00 | +£10.00 |

Every job between roughly £430 and £1,667 lost money, and every free job lost
£5.00 flat. FEE-11 recorded that cost and accepted it
(`areas/motko.md`, 1 Sep 2026) on the reasoning that the ceiling it removed was
the control on leakage. It was not; the processing cost was.

Passing processing through at cost removes the loss without inventing a margin,
and the subscription supplies the recurring revenue the per-job fee never could.

---

## What a contractor pays

Service fee marginal at 0.4% / 0.3% above £5,000, with the £2.00 floor retained
(see Open questions). Processing at 0.5% + £0.20 capped £5.00.

| Job value | Service fee | Processing | Total | Total as % of job | Old total |
|---|---|---|---|---|---|
| £250 | £2.00 | £1.45 | £3.45 | 1.38% | £2.00 |
| £500 | £2.00 | £2.70 | £4.70 | 0.94% | £2.00 |
| £1,000 | £4.00 | £5.00 | £9.00 | 0.90% | £3.00 |
| £2,500 | £10.00 | £5.00 | £15.00 | 0.60% | £7.50 |
| £5,000 | £20.00 | £5.00 | £25.00 | 0.50% | £15.00 |
| £7,500 | £27.50 | £5.00 | £32.50 | 0.43% | £20.00 |
| £10,000 | £35.00 | £5.00 | £40.00 | 0.40% | £25.00 |
| £15,000 | £50.00 | £5.00 | £55.00 | 0.37% | £32.50 |
| £25,000 | £80.00 | £5.00 | £85.00 | 0.34% | £47.50 |

Plus £9.99 per month once free jobs are spent.

This is a real increase — roughly 1.7x to 3x per job — and it is deliberate. It
should be described as a reprice, never as "surfacing a cost we already bore".

### The published copy

The originating instruction was *"a small payment processing fee, about 0.6% to
0.8% in total depending on the job size"*. That band cannot be published as
written: it describes neither component. Real processing runs 0.58% at £250 and
falls to 0.02% at £25,000 as the £5 cap bites, so 0.6–0.8% is above cost
everywhere and roughly six times cost on a £5,000 job. Publishing it as a
processing fee would be the FEE-9 defect committed deliberately — the site
naming a charge the app does not make.

The combined figure that IS true is the "Total as % of job" column: about 0.9%
on small jobs falling below 0.4% on large ones. Publish the three components
separately and let the table show the combination.

---

## Files

- `src/lib/motko-fee.ts` — service-fee ladder constants and processing
  constants; `estimateStripeProcessingFeePennies` added
- `src/lib/stripe-payments.ts` — `applicationFeeForPayment` returns
  processing + service
- `src/app/api/stripe/webhook/route.ts` — reads `balance_transaction.fee`,
  writes the three processing columns
- `src/lib/paid-job-settlement.ts` — waiver applies to the service component only
- `src/lib/pricing-facts.ts` — published constants, processing row added
- `src/lib/fee-copy.ts` — in-app lines name all three charges
- `site/pricing.html`, `site/index.html`, `src/app/terms/page.tsx` — copy
- `src/lib/subscription.ts` (new) — entitlement state and billing
- `supabase/migrations/…_subscription.sql` (new) — subscription columns

---

## Build order

Schema precedes code (`CLAUDE.md`), and the reprice must land as one release so
the site and the app never state different prices.

1. **Service-fee ladder** — retune `motko-fee.ts` to 0.4% / 0.3% above £5,000.
   Two constants and a removed third band; `pricing-facts.ts` and
   `pricing-copy.test.ts` follow automatically because every published figure is
   already derived from `motkoFeePennies`.
2. **Processing pass-through** — reinstate FEE-7 from `origin/factory/475`,
   whose spec survives at `docs/specs/475.md` and is written against this exact
   design. Migration `00000000000054_processing_fee_columns.sql` is already
   applied to production and its three columns are live and unwritten, so no new
   migration is needed for this step.
   **One change from that spec:** its free-job edge case waives the service fee
   and charges processing, which is now the decided rule rather than an
   incidental one.
3. **Copy** — ships with steps 1–2, never before them.
4. **Subscription** — the large build, and the only part needing new schema.
   Web-only (see App Store below).

Steps 1–3 are shippable on their own and fix the loss-making per-job position.
Step 4 is independent and should not hold them.

---

## App Store

**Decided: web-only billing.** The subscription is sold on motko.app only; the
iOS app carries no purchase flow.

The exposure this manages: `APP_STORE_CHECKLIST.md` §6 rests the entire non-IAP
position on payments being for "physical/off-platform services". That defence
covers a commission on real-world work. It does not obviously cover a recurring
charge for access to the app, which is Guideline 3.1.1 territory and would carry
Apple's 15–30% — £1.50 to £3.00 of every £9.99.

§6 is unticked and now load-bearing. **Settle it against actual App Review
correspondence before the next submission**, and before any subscription code
reaches the iOS target. Apple's anti-steering rules also constrain what the app
may say about web billing; that needs a real read rather than an assumption.

---

## Frozen acceptance tests

The reprice was checked against every frozen assertion that pins a fee figure.
**Exactly one breaks**, because the rest either derive their expectations from
`motkoFeePennies` at runtime or happen to sit on a job value where the old and
new fees coincide (0.4% of £500 is £2.00, the old floor).

To be retired by the first commit of the implementing item, per AGENTS.md:

- `tests/acceptance/215.test.ts` — **"application_fee_amount is set correctly
  for a standard job"**. Asserts `motkoFeePennies(60_000, 0) === 200` on a £600
  job. Under the new ladder that is £2.40. Superseded by this decision.

Everything else in 215, all of 331, `free-job-waiver-and-cap.test.ts` and
`pricing-copy.test.ts` keep running unchanged. Any *other* failure is a defect,
not a retirement candidate (AGENTS.md, condition 4).

One assertion needs watching rather than retiring: 215's "application_fee_amount
is omitted (or zero) for a free job" tests `motkoFeePennies`, which still
returns 0 for a free job. It stays true. But the *application fee* on a free job
is no longer zero — it is the processing estimate — so the behaviour that
assertion's name describes has changed even though its assertion has not.

---

## Open questions

1. **The £2.00 service-fee floor.** Retained here because it is the status quo
   and was not part of the instruction. Dropping it would make a £250 job
   £1.00 + £1.45 = £2.45 (0.98%) instead of £3.45 (1.38%), which buys a cleaner
   "always under 1%" story at the small end and costs little, since the
   subscription now carries the base revenue the floor was protecting.
2. **Referral rewards.** Free jobs now waive the service fee and the
   subscription but not processing. A reward granted to a contractor who is
   already subscribed needs a defined meaning — free months, or banked jobs that
   suspend billing.
3. **VAT.** `VAT_REGISTERED` is `false`. A £9.99 recurring charge reaches the
   £90k threshold at roughly 750 subscribers, considerably sooner than per-job
   fees would. Registration adds VAT to the fee rather than being absorbed by
   it, and `/pricing` promises to say so before it takes effect.
4. **Subscription mechanics.** Nothing exists: no `stripe.subscriptions`, no
   prices, no billing portal, no proration. `fee-collection.ts` has dunning
   planning, but PAY-5 removed the rail it drove. Start date, failed-payment
   behaviour and what a lapsed subscription restricts are all undefined.
