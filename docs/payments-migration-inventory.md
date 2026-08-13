# Payments Migration Inventory

**Prepared:** 2026-08-12  
**Purpose:** Complete inventory of TrueLayer and legacy Stripe surface area as prerequisite for PAY-2 through PAY-5 migration tickets  
**Context:** TrueLayer declined onboarding (12 Aug 2026); Stripe account remains fully active with Pay by Bank capability

---

## TrueLayer surface area

### Environment variables

Seven environment variables configure TrueLayer client credentials, signing material, and fee collection beneficiary:

1. **TRUELAYER_CLIENT_ID** — OAuth client identifier for the payments scope
2. **TRUELAYER_CLIENT_SECRET** — OAuth client secret for client_credentials token grant
3. **TRUELAYER_ENV** — Environment selector: `"sandbox"` or `"live"`
4. **TRUELAYER_SIGNING_KID** — Key ID for the ES512 request-signing key registered with TrueLayer
5. **TRUELAYER_SIGNING_PRIVATE_KEY_B64** — Base64-encoded EC P-521 private key PEM for signing payment creation requests
6. **TRUELAYER_MERCHANT_ACCOUNT_ID** — TrueLayer merchant account ID for motko fee collections (VRP pull destination)
7. **MOTKO_FEE_BENEFICIARY_NAME** — Account holder name displayed to trades during fee mandate authorization (defaults to "Motko")

All seven are referenced in `src/lib/truelayer.ts` (lines 47-94).

### Core library files

Four library files implement TrueLayer integration:

1. **src/lib/truelayer.ts** (172 lines)
   - Configuration resolution (`getTrueLayerConfig`, `getTrueLayerSigning`, `getMotkoFeeBeneficiary`)
   - Hosted Payment Page URL builders (`buildHostedPaymentPageUrl`, `buildMandateHostedPageUrl`)
   - Payment rails availability gate (`isPaymentRailsAvailable`)
   - Signing key self-check (`checkSigningKey`)
   - No networked I/O — pure configuration and URL construction

2. **src/lib/truelayer-payments.ts** (253 lines)
   - Payment creation (`createTrueLayerPayment`)
   - Payment status polling (`getTrueLayerPaymentStatus`)
   - Webhook signature verification (`verifyTrueLayerWebhook`)
   - OAuth token caching for payments scope
   - JWS signing via `truelayer-signing` npm package

3. **src/lib/truelayer-vrp.ts** (311 lines)
   - Commercial VRP mandate creation (`createTrueLayerMandate`)
   - Mandate status polling (`getTrueLayerMandateStatus`)
   - Fee collection charge (`chargeMandate`)
   - Mandate payment status polling (`getTrueLayerMandatePaymentStatus`)
   - Timeout wrapper integration from #93 (line 277-291)
   - Idempotency conflict handling (409 responses, line 296-301)

4. **src/lib/truelayer.test.ts** (test coverage)
   - Validates signing key check logic
   - Tests Hosted Payment Page URL construction
   - Pure tests — no networked TrueLayer calls

### API routes

Two Next.js API routes handle payment creation and webhook delivery:

1. **src/app/api/truelayer/create-payment/route.ts** (`POST /api/truelayer/create-payment`)
   - Line 39-45: Gates on `getTrueLayerConfig()` and `getTrueLayerSigning()`, returns 503 when unconfigured
   - Line 96-117: Calls `createTrueLayerPayment` wrapped in `withTimeout`
   - Line 138-140: Stores `payment.id` to `invoices.truelayer_payment_id`
   - Line 142-146: Builds and returns Hosted Payment Page URL
   - Listed in `PUBLIC_API_ROUTES` (middleware.ts line 9)

2. **src/app/api/truelayer/webhook/route.ts** (`POST /api/truelayer/webhook`)
   - Line 36-44: Calls `verifyTrueLayerWebhook` to authenticate payload
   - Line 59-76: Handles `payment_executed` event for both customer pay-ins and fee collections
   - Line 77-82: Handles `payment_failed` event for fee collections (enters dunning)
   - Maps back to records via echoed metadata (`invoice_id`, `fee_collection_id`)
   - Listed in `PUBLIC_API_ROUTES` (middleware.ts line 10)

### Integration points

Files that import TrueLayer modules or reference TrueLayer identifiers:

**Production call sites:**

- `src/app/i/[id]/page.tsx:7` — imports `isPaymentRailsAvailable` to decide whether to show PayButton
- `src/app/i/[id]/pay-button.tsx:24` — fetches `/api/truelayer/create-payment` on button press
- `src/app/settings/page.tsx:11` — imports `getTrueLayerMandateStatus` to poll mandate authorization state
- `src/app/settings/fee-billing-actions.ts:5,11` — imports `createTrueLayerMandate`, `buildMandateHostedPageUrl`, `getTrueLayerConfig`, `getTrueLayerSigning`
- `src/app/api/cron/chase/route.ts:15` — imports `isPaymentRailsAvailable` to gate pay-by-bank links in chase emails
- `src/lib/collect-fees.ts:7` — imports `chargeMandate`, `getTrueLayerMandatePaymentStatus` for monthly fee collection
- `src/lib/settle-paid-job.ts:17` — handles TrueLayer payment settlement (writes `payment_provider_ref`, accrues fees)

**Test-only references:**

- `tests/acceptance/93.test.ts` — imports TrueLayer modules for mocking idempotency fix
- `tests/acceptance/99.test.ts` — asserts middleware allowlist includes TrueLayer routes
- `tests/acceptance/101.test.ts` — tests fee collection flow (mocks TrueLayer)
- `tests/acceptance/152.test.tsx` — tests customer payment flow (mocks TrueLayer)
- `src/app/api/truelayer/create-payment/route.test.ts` — unit tests for payment creation route

### Database columns

Nine columns across four tables store TrueLayer state:

**invoices table:**
- `truelayer_payment_id text` — TrueLayer payment ID for status polling and reconciliation (migration 024 line 29)
- `payment_method text` — How invoice was paid: `'motko_bank'` for TrueLayer, or manual methods (migration 027 line 9)
- Index: `invoices_truelayer_payment_id_idx` on `(truelayer_payment_id) WHERE truelayer_payment_id IS NOT NULL`

**contractors table:**
- `payout_account_holder_name text` — Trade's bank account name for external beneficiary payments (migration 024 line 13)
- `payout_sort_code text` — 6-digit sort code, CHECK constraint enforces format (migration 024 line 15-16)
- `payout_account_number text` — 8-digit account number, CHECK constraint enforces format (migration 024 line 18-19)
- `payout_details_complete boolean NOT NULL DEFAULT false` — Computed flag: all three beneficiary fields present (migration 024 line 23-24)
- `fee_mandate_id text` — TrueLayer commercial VRP mandate ID for fee collections (migration 023 line 100)
- `fee_mandate_status text` — Mandate authorization state: `'authorization_required'`, `'authorizing'`, `'authorized'`, `'failed'`, `'revoked'` (migration 025 line 16-18)
- `fee_collection_status text NOT NULL DEFAULT 'active'` — Billing lifecycle: `'active'`, `'past_due'`, `'paused'` (migration 023 line 101-102)

**jobs table:**
- `payment_provider_ref text` — TrueLayer payment ID for the job's first payment (migration 023 line 146)
- Index: `jobs_payment_provider_ref_idx` on `(payment_provider_ref) WHERE payment_provider_ref IS NOT NULL` (migration 023 line 148-150)

**fee_collections table:**
- `provider_collection_ref text` — TrueLayer payment ID for the mandate charge (migration 023 line 87)
- `attempts int NOT NULL DEFAULT 0` — Dunning attempt counter (migration 025 line 23)
- `last_attempt_at timestamptz` — Timestamp of most recent charge attempt, gates retry interval (migration 025 line 24)
- `failure_reason text` — Diagnostic reason for most recent charge failure (migration 025 line 25)

### Idempotency work from #93

Migration #93 (Fee collection idempotency fix) added three safeguards to prevent double-debits:

1. **Stable idempotency keys** — Derived from `fee_collection.id` alone, byte-identical across all retry attempts (previously included attempt counter)
2. **Timeout wrapper** — `chargeMandate` wrapped in `withTimeout(..., TIMEOUT_MS.truelayer, "chargeMandate")` at `src/lib/truelayer-vrp.ts:277-291`
3. **Pre-charge status check** — Before retry (attempts > 1), queries prior payment status via `getTrueLayerMandatePaymentStatus` and skips re-charge if already executed
4. **Idempotency conflict handling** — 409 responses set `isIdempotencyConflict` flag for reconciliation path (`src/lib/truelayer-vrp.ts:296-301`)

The timeout wrapper uses `src/lib/with-timeout.ts` with `TIMEOUT_MS.truelayer = 12_000` (12 seconds).

### Public middleware allowlist from #99

Migration #99 (Explicit route allowlist) added TrueLayer routes to `PUBLIC_API_ROUTES` constant in `src/lib/supabase/middleware.ts`:

- `/api/truelayer/create-payment` (line 9)
- `/api/truelayer/webhook` (line 10)

These routes bypass authentication checks. Any Stripe replacement routes (PAY-2, PAY-3) must be added to this list.

### npm dependencies

One npm package provides TrueLayer-specific functionality:

- **truelayer-signing** (package.json) — JWS signing and webhook verification library
  - Used by: `src/lib/truelayer-payments.ts`, `src/lib/truelayer-vrp.ts`
  - Functions: `sign()`, `verify()`, `extractJku()`
  - Can be removed once all TrueLayer code is deleted (PAY-5)

---

## Legacy Stripe code classification

### Reusable

Concepts from the pre-TrueLayer Stripe integration that inform the Stripe Pay by Bank migration:

**Environment variable structure:**
- Pattern of secret key, webhook secret, and publishable key (`.env.example` lines 19-22)
- Same three-credential model applies to Stripe Pay by Bank

**Webhook verification patterns:**
- Signature verification required before trusting webhook payload
- TrueLayer uses JWS with JWKS fetch; Stripe uses HMAC with shared secret
- Both reject unsigned/invalid payloads with 400

**Database column patterns:**
- Provider-specific payment ID storage (e.g., `truelayer_payment_id`) suggests `stripe_payment_session_id` or similar for Stripe Pay by Bank
- Payment method enum pattern (`payment_method` column) extends to new Stripe values

**Error handling:**
- Timeout wrappers for external API calls (established pattern in `with-timeout.ts`)
- Service-unavailable (503) responses when provider unconfigured
- Idempotency key stable across retries (learned from #93 fix)

### Delete

Code and columns that serve no purpose and should be removed:

**Database columns (7 total):**

From `invoices` table:
1. `stripe_invoice_id text` (migration 001 line 92) — Never written by current code
2. `stripe_payment_link_id text` (migration 006 line 2) — Never written by current code
3. `stripe_payment_link_url text` (migration 006 line 3) — Never written by current code

From `contractors` table:
4. `stripe_account_id text` (migration 021 line 5) — Stripe Connect account ID, unused since TrueLayer adoption
5. `stripe_charges_enabled boolean NOT NULL DEFAULT false` (migration 021 line 6) — Stripe Connect capability flag, unused
6. `stripe_payouts_enabled boolean NOT NULL DEFAULT false` (migration 021 line 7) — Stripe Connect capability flag, unused
7. `stripe_requirements_due boolean NOT NULL DEFAULT false` (migration 021 line 10) — Stripe Connect verification status, unused

Plus unique index: `contractors_stripe_account_id_key` (migration 021 line 13-15)

**Environment variables (4 total in .env.example, no code consuming them):**
1. `STRIPE_SECRET_KEY` (.env.example line 20) — No imports of `stripe` npm package in src/
2. `STRIPE_WEBHOOK_SECRET` (.env.example line 21) — No webhook verification code
3. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (.env.example line 22) — Not referenced in any client component
4. `PLATFORM_APPLICATION_FEE_PENCE` (.env.example line 26) — Stripe Connect application fee, not used

**Note:** These variables exist in `.env.example` for documentation but have no corresponding code. They are remnants from when Stripe Connect was planned but never fully implemented.

### Replace

Active integrations that must be swapped for Stripe equivalents:

**None.** There are no active Stripe integrations in production. The codebase moved from "planned Stripe Connect" directly to TrueLayer without an interim Stripe production deployment. Therefore:

- No Stripe SDK dependency in package.json
- No Stripe API routes in src/app/api/
- No Stripe webhook handlers
- No Stripe initialization code

All payment rails are TrueLayer. The migration is TrueLayer → Stripe Pay by Bank, not Stripe Connect → Stripe Pay by Bank.

---

## Data model surface

### Must preserve for historical records

These columns reference settled money and cannot be dropped even after TrueLayer deprecation:

**invoices.truelayer_payment_id (text)**
- Records which TrueLayer payment cleared the invoice
- Required for: reconciliation, customer receipt, dispute resolution
- Migration strategy: Keep column, stop writing new values post-migration

**jobs.payment_provider_ref (text)**
- TrueLayer payment ID for the job's first payment
- Ties fee accrual to the specific settled payment
- Migration strategy: Keep column, write Stripe equivalents to a new `stripe_payment_session_id` column or rename this to `payment_provider_ref` (already provider-agnostic)

**fee_collections.provider_collection_ref (text)**
- TrueLayer mandate payment ID for the settled fee collection
- Audit trail for money moved from trade to motko
- Migration strategy: Keep column, write Stripe payment IDs to same column (already provider-agnostic name)

### Migration-scoped

These columns drive active fee collection and must be migrated to Stripe equivalents:

**contractors.fee_mandate_id (text)**
- TrueLayer commercial VRP mandate ID
- Replacement: Stripe customer ID + payment method ID or Stripe Billing subscription ID
- Migration strategy: Dual-write during transition, then cut over

**contractors.fee_mandate_status (text)**
- TrueLayer mandate authorization state: `'authorization_required'`, `'authorizing'`, `'authorized'`, `'failed'`, `'revoked'`
- Replacement: Stripe-equivalent states or simplified to `'authorized'` / `'not_authorized'`
- Migration strategy: Map TrueLayer states to Stripe states during cutover

**contractors.fee_collection_status (text)**
- Billing lifecycle: `'active'`, `'past_due'`, `'paused'`
- Provider-agnostic semantics — no schema change needed
- Migration strategy: Keep as-is, drives billing regardless of provider

### Transient

Dunning state that resets per collection — no migration required:

**fee_collections.attempts (int)**
- Retry attempt counter, resets to 0 for each new collection
- Provider-agnostic
- Migration strategy: Keep as-is

**fee_collections.last_attempt_at (timestamptz)**
- Gates retry interval for current collection
- Provider-agnostic
- Migration strategy: Keep as-is

**fee_collections.failure_reason (text)**
- Diagnostic string for most recent charge failure
- Provider-specific error codes, but semantics unchanged
- Migration strategy: Keep column, write Stripe error codes post-migration

### Payout beneficiary (TrueLayer-specific, must preserve)

**contractors.payout_account_holder_name (text)**
**contractors.payout_sort_code (text)**
**contractors.payout_account_number (text)**
**contractors.payout_details_complete (boolean)**

These store the trade's bank account for external beneficiary payments. TrueLayer required them because payments settle directly to the trade's account. Stripe Pay by Bank may use a different model (e.g., Stripe Financial Connections for account linking), but the bank details must be preserved for:
- Historical TrueLayer payments that already settled
- Possible Stripe Pay by Bank beneficiary setup (TBD in PAY-2 spec)

Migration strategy: Assess in PAY-2 whether Stripe Pay by Bank requires explicit beneficiary details or uses Stripe-managed account linking. If latter, keep columns for historical reference but stop gating on `payout_details_complete`.

---

## Dependency map

Which files each later migration ticket must modify:

### PAY-2: Payment flow replacement

Replace TrueLayer customer pay-ins with Stripe Pay by Bank (or Stripe Payment Links / Checkout).

**Files to modify:**
- `src/app/api/truelayer/create-payment/route.ts` → rename/replace with `/api/stripe/create-payment-session/` or equivalent
- `src/lib/truelayer-payments.ts` → create `src/lib/stripe-payments.ts` with equivalent `createStripePayment` and `verifyStripeWebhook` functions
- `src/app/i/[id]/page.tsx` → update `isPaymentRailsAvailable` import or replace with Stripe equivalent check
- `src/app/i/[id]/pay-button.tsx` → change fetch target from `/api/truelayer/create-payment` to Stripe route
- `src/lib/supabase/middleware.ts` → add new Stripe payment route to `PUBLIC_API_ROUTES`
- Database: possibly add `stripe_payment_session_id` column to invoices table (or reuse provider-agnostic `payment_provider_ref`)

**Depends on:**
- Stripe Pay by Bank product availability (already enabled per spec)
- Decision: Payment Links vs Checkout vs Pay by Bank API

### PAY-3: Webhook migration

Replace TrueLayer webhook with Stripe webhook for payment settlement and fee collection.

**Files to modify:**
- `src/app/api/truelayer/webhook/route.ts` → create parallel `/api/stripe/webhook/route.ts`
- `src/lib/truelayer-payments.ts` (`verifyTrueLayerWebhook`) → create `verifyStripeWebhook` using `stripe` SDK
- `src/lib/settle-paid-job.ts` → handle both TrueLayer and Stripe payment sources during transition
- `src/lib/collect-fees.ts` → handle both provider webhook payloads for fee settlement
- `src/lib/supabase/middleware.ts` → add `/api/stripe/webhook` to `PUBLIC_API_ROUTES`
- Database: no schema changes, writes `payment_method = 'stripe_bank'` or similar

**Depends on:**
- Stripe webhook signing secret provisioned
- Event types mapped: `payment_intent.succeeded` or equivalent → `payment_executed` semantics

### PAY-4: Fee collection replacement

Replace TrueLayer commercial VRP with Stripe equivalent (ACH debit, BACS Direct Debit, or Stripe Billing).

**Files to modify:**
- `src/lib/truelayer-vrp.ts` → create `src/lib/stripe-fee-collection.ts` with mandate setup and charge functions
- `src/lib/collect-fees.ts` → swap `chargeMandate` call to Stripe equivalent
- `src/app/settings/fee-billing-section.tsx` → update mandate authorization flow UI
- `src/app/settings/fee-billing-actions.ts` → replace `createTrueLayerMandate` with Stripe setup intent or customer creation
- `src/app/settings/page.tsx` — update mandate status polling
- Database: migrate `fee_mandate_id` to Stripe customer/subscription ID, update `fee_mandate_status` enum if needed

**Depends on:**
- Stripe product choice: BACS Direct Debit vs ACH (UK context suggests BACS)
- Stripe Financial Connections for account linking, or manual beneficiary entry

### PAY-5: Deprecation & cleanup

Remove all TrueLayer code and unused Stripe columns after confirming zero active references.

**Files to delete:**
- `src/lib/truelayer.ts`
- `src/lib/truelayer-payments.ts`
- `src/lib/truelayer-vrp.ts`
- `src/lib/truelayer.test.ts`
- `src/app/api/truelayer/create-payment/route.ts`
- `src/app/api/truelayer/create-payment/route.test.ts`
- `src/app/api/truelayer/webhook/route.ts`

**Files to modify:**
- `src/lib/supabase/middleware.ts` — remove TrueLayer routes from `PUBLIC_API_ROUTES`
- `.env.example` — remove TrueLayer env vars (7) and unused Stripe env vars (4)
- `package.json` — remove `truelayer-signing` dependency

**Database migrations to create:**
- Drop 7 legacy Stripe columns (see "Delete" category above) IF they contain no production data
  - Check `SELECT COUNT(*) FROM invoices WHERE stripe_invoice_id IS NOT NULL` etc. first
  - If non-zero, preserve columns but document as "legacy, do not write"
- Do NOT drop TrueLayer columns in "Must preserve" category:
  - Keep `invoices.truelayer_payment_id`, `jobs.payment_provider_ref`, `fee_collections.provider_collection_ref`
- Assess migration-scoped columns:
  - If all trades migrated to Stripe mandates, `contractors.fee_mandate_id` can store Stripe IDs (no schema change)
  - `contractors.fee_mandate_status` may need enum expansion or can be simplified

**Depends on:**
- PAY-2, PAY-3, PAY-4 all complete and deployed
- Confirmation that no in-flight TrueLayer payments exist (see section 5)
- Decision on whether to preserve beneficiary columns (payout_account_holder_name, etc.) for historical reference

---

## In-flight and historical payment count

**Status:** Unknown — requires production database query.

To determine whether PAY-5 deprecation needs a backfill/reconciliation step or can simply halt new TrueLayer operations, the following counts are required from the production database:

### Queries needed

```sql
-- Invoices with TrueLayer payment references
SELECT COUNT(*) FROM invoices WHERE truelayer_payment_id IS NOT NULL;

-- Jobs with provider payment references (includes TrueLayer)
SELECT COUNT(*) FROM jobs WHERE payment_provider_ref IS NOT NULL;

-- Fee collections settled via TrueLayer
SELECT COUNT(*) FROM fee_collections 
WHERE provider_collection_ref IS NOT NULL AND status = 'collected';

-- Stranded fee collections (pending or failed)
SELECT COUNT(*) FROM fee_collections 
WHERE status IN ('pending', 'failed');

-- Legacy Stripe data (determines if DROP COLUMN is safe)
SELECT 
  COUNT(*) FILTER (WHERE stripe_invoice_id IS NOT NULL) as stripe_invoice_count,
  COUNT(*) FILTER (WHERE stripe_payment_link_id IS NOT NULL) as stripe_link_count
FROM invoices;

SELECT 
  COUNT(*) FILTER (WHERE stripe_account_id IS NOT NULL) as stripe_account_count
FROM contractors;
```

### What the counts mean for PAY-5

- **High invoice/job counts (hundreds-thousands):** TrueLayer columns must be preserved indefinitely for historical reconciliation. PAY-5 stops writing new values but does not drop columns.

- **Stranded fee collections > 0:** PAY-5 must include a reconciliation step — either manually resolve or mark as "migration cutover — manual review required."

- **Legacy Stripe columns with non-zero counts:** These contain data from a migration predating this audit. PAY-5 becomes a data-preserving migration (rename, document as legacy) rather than a simple DROP COLUMN.

- **All counts zero (or near-zero test data):** PAY-5 can confidently drop columns and remove all TrueLayer code without a backfill step.

**Recommendation:** Run these queries against production before speccing PAY-5. If production access is unavailable, state "count unknown — reconciliation strategy deferred to PAY-5 implementation" and proceed with the assumption that TrueLayer columns in the "Must preserve" category are never dropped.

---

## References

- **Migration #93** (Idempotency fix): `docs/specs/93.md` — Stable keys, timeout wrapper, pre-charge status check
- **Migration #99** (Middleware allowlist): `docs/specs/99.md` — Explicit route list replaces prefix matching
- **Middleware public routes:** `src/lib/supabase/middleware.ts:6-17` — `PUBLIC_API_ROUTES` constant
- **Database migrations:** `supabase/migrations/00000000000001_init_schema.sql`, `000006`, `000021`, `000023`, `000024`, `000025`, `000027`
- **TrueLayer rejection email:** Received 12 Aug 2026 (referenced in spec 193.md line 8)

---

**Inventory complete.** All TrueLayer surface area cataloged, legacy Stripe code classified, and dependency map established for PAY-2 through PAY-5.
