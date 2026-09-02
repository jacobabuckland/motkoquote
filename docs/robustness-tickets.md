# Pass C — tickets

**Grounded against:** `main` @ `f4947aa`. Derived from `docs/pipeline-map.md` (Pass A) and
`docs/robustness-review-findings.md` (Pass B). File paths are real and were read.

---

## Preamble — what Pass B changed

Three things in the brief's §6 did not survive verification, and one ticket set was added.

**Stage 2 (R1–R5) is dropped in full.** It is the factory's `PRICE` programme, merged 28–31 Aug
(#420, #426, #443, #452, #482) — six days before the brief was written, by an author who could not
see the repository. Nothing in R1–R5 is re-ticketed. `stated_prices` exists with the proposed
schema, provenance exists and gates the send, and both are demonstrably live on production rows.

**The 55% ship gate is dropped.** The draft-vs-final diff measures a fixed-mode collapse, not user
rejection: the distribution is perfectly bimodal (identical, or collapsed to exactly one line),
nine of the ten collapses were code, and four of the 23 quotes were never AI-drafted at all.
`PFIX-7` replaces the metric.

**O2 is rewritten.** There is no RLS problem — `client_errors` and `feedback` have no migration
and no writer, so nothing is being blocked. The real gap is that all three error boundaries
`console.error` and stop, which is invisible in a WKWebView. `OBS-2` addresses that instead.

**Added: `PFIX-*`.** Verification found six live defects in the shipped price chain, two of which
put materially wrong money on customer documents today. They are not in the brief. Per `AGENTS.md`
("Money… escalate to a human, always, regardless of how confident you are") and the brief's own
D12, **none is queued as factory work.** They sit in Backlog for Jacob.

**Priority order, changed from the brief.** `OBS-1` (the voice funnel) is now first, ahead of the
run viewer. In August 17 of 18 jobs were typed by hand and one voice session ran all month, after
a 41% mid-call abandonment rate in July. Whether voice is failing or simply unused is the
product's central unknown, and no ticket in the brief asks it.

---

## Stage 0 — make the pipeline observable

Queued **Ready for factory**. Additive, no pricing path touched, independent of each other.

### OBS-1: Instrument the voice funnel end to end
- **Stage:** 0 · **Effort:** M · **Module:** voice · **Depends on:** — · **Risk:** low; additive events only
- **Files:** `src/app/jobs/actions.ts` (`createRealtimeSession` :83, `completeSowConversation` :355, `reportVoicePipelineFailure` :948), `src/components/voice/job-intake.tsx` (:970 capture, :1033 speech events), `src/lib/analytics.ts`
- **Change:** Emit `voice_session_started` when the job row is inserted at session mint, and
  `voice_session_abandoned` when a session ends without reaching `completeSowConversation`. Carry a
  `run_id` on every event in the chain so a session can be followed across stages. Today only
  `voice_session_completed` exists, and only when the caller supplied a `wrapReason`, so a session
  that never started is indistinguishable from one that hung on "Listening".
- **AC:** Every job row created by `createRealtimeSession` has a matching `voice_session_started`.
  A session abandoned before wrap produces exactly one `voice_session_abandoned`. Abandonment rate
  is computable from `events` alone for any date range. A completed session's events share one
  `run_id`.
- **Why now:** July's abandonment rate was 41% (11 abandoned, 16 completed) and is currently only
  inferable from orphaned `sow_in_progress` job rows, which the manual-job path also produces.

### OBS-2: Report client-side crashes instead of writing them to a console nobody reads
- **Stage:** 0 · **Effort:** S · **Module:** app · **Depends on:** — · **Risk:** low
- **Files:** `src/app/global-error.tsx:17`, `src/app/error.tsx:18`, `src/app/jobs/new/error.tsx:20`, `src/app/actions.ts` (`reportRealtimeConnectFailure` :32), `src/lib/analytics.ts` (`logError` :90)
- **Change:** All three error boundaries currently call `console.error` and stop. Route them
  through a server action to `logError`, carrying the route, the digest and the `run_id` where one
  exists. The app runs in a WKWebView with no inspector attached, so a console line reaches nobody.
  `reportRealtimeConnectFailure` is the existing pattern to copy — it is the only client-originated
  error path in the tree.
- **AC:** A render-phase crash in the app produces an `error` row in `events` tagged with its
  route, within one page load. The existing Realtime-connect path keeps working unchanged. No
  crash path writes only to the console.
- **Note:** Do **not** add `client_errors` or `feedback` tables — see `PFIX-8`.

### OBS-3: A run viewer at `/admin/runs/[jobId]`
- **Stage:** 0 · **Effort:** M · **Module:** voice · **Depends on:** — · **Risk:** low; read-only surface
- **Files:** new route under `src/app/`; reads `jobs.transcript`, `jobs.conversation_json`, `jobs.sow_json`, `jobs.extracted_json`, `quotes.drafted_line_items_json`, `quotes.line_items_json`, `quotes.contractor_flags_json`
- **Change:** Six panes in pipeline order — conversation turns, flat transcript, SoW state
  (including `stated_prices`), extraction, drafted lines, final lines — with a draft-vs-final diff
  that **labels a fixed-mode collapse as a collapse rather than as deletions**. Contractor-scoped,
  behind an admin flag. Show `provenance` per line: it is written and gates the send today but is
  rendered nowhere, so no human can see which line came from where.
- **AC:** Given a job where a stated price did not reach the quote, the stage at which it was lost
  is identifiable in under 30 seconds without a database query. A fixed-mode quote does not display
  its collapsed lines as deletions. Each line's provenance source is visible.
- **Note:** No audio pane — there is no audio to show (see `PFIX-8`).

### OBS-4: An in-app "something's wrong" report
- **Stage:** 0 · **Effort:** S · **Module:** app · **Depends on:** OBS-1, OBS-2 · **Risk:** low
- **Files:** new component; `src/lib/analytics.ts`; the `events` table
- **Change:** A button that attaches the current `run_id`, the route, and the last N client log
  lines to a report a human can open. Write it to `events` — the one reporting table that exists,
  has RLS policies and works — not to a new table.
- **AC:** A tester report arrives already linked to the run that produced it and is openable in
  the OBS-3 viewer. Submitting it never blocks or breaks the page it was sent from.

---

## Stage 1 — the fixture harness

Queued **Ready for factory**, sequenced: `HARN` is now in `SEQUENTIAL_PROGRAMMES`
(`scripts/factory/admission-order.mjs:27`), so each item is admitted only once its predecessor has
merged.

**This is the highest-leverage work in the document, and Pass B raised its priority.** Production
produced **four** drafted line items in the five days after PRICE-5 shipped. Organic volume will
not tell anyone whether the price-fidelity chain works. A fixture harness is the only instrument
that can.

### HARN-1: A fixture corpus for the quote pipeline
- **Stage:** 1 · **Effort:** M · **Module:** voice · **Depends on:** — · **Risk:** low; test-only, but see PII note
- **Files:** new `fixtures/pipeline/*.json`; existing `fixtures/fenland-bathroom.md`, `src/lib/fixtures/fenland-bathroom.ts`
- **Change:** Commit a corpus of pipeline fixtures. **Each fixture needs three parts, not one** —
  there is no transcript→`SowState` function anywhere in the tree, so a transcript alone drives
  nothing: (a) the verbatim transcript string, which drives `extractStatedPrices`; (b) a
  hand-authored `SowState`, which is the real input to drafting; (c) the expected extraction and
  expected line items. Production holds 19 transcripts from 9 contractors, of which 11 are
  substantial (>500 chars) and **only one carries a `stated_prices` baseline** — so every expected
  output is hand-authored, and that is the bulk of the work.
- **AC:** No customer name, address, phone or email appears in any committed fixture. Each fixture
  has a hand-verified expected extraction and expected line items. At least one fixture covers a
  stated price that is superseded mid-call, and at least one covers a fixed-mode quote.
- **PII note:** `fixtures/fenland-bathroom.md` carries a real customer name, address and phone in
  plain text today. Redact it as part of this item.
- **Effort warning:** the brief absorbed this into a 2-day Stage 1. It is per-scenario work and
  should be tracked separately.

### HARN-2: A replay harness that runs the pipeline offline
- **Stage:** 1 · **Effort:** M · **Module:** voice · **Depends on:** HARN-1 · **Risk:** low
- **Files:** new `vitest.pipeline.config.ts`; new `npm run test:pipeline` script in `package.json`; a record/replay wrapper around `src/lib/claude.ts:8`
- **Change:** Run fixture → `sowToExtraction` → `draftQuoteLineItems` → `compileDraftToLineItems`
  → totals, offline, with model responses recorded to cassettes and replayed by default.
  `src/lib/guest/quote.ts:73` `draftGuestQuote` already runs this chain with **zero** Supabase,
  `next/*` or `server-only` in its import graph (verified by transitive walk), so no prerequisite
  refactoring is required. The seam is `src/lib/claude.ts:8`, which constructs the Anthropic client
  lazily per call. **Stub the three DB lookups explicitly** — `findSimilarPastJobs`,
  `findKnownMaterialPrices`, `getContractorTendencies` all swallow failures and return `[]`, so an
  unstubbed harness would silently replay a different pipeline than production, green and wrong.
- **AC:** `npm run test:pipeline` runs offline with no network and no API key, in under 60s. A
  deliberate 1p change to any expected line fails a named test. Re-recording is an explicit opt-in
  flag, following the `UPDATE_QUOTE_PDF_GOLDEN=1` precedent.
- **Note:** the repo is **npm**, not pnpm. `DRAFTING_TEMPERATURE` is 1.0, so a re-record is not
  reproducible — the cassette is the contract and a re-record needs human review.

### HARN-3: A golden render for the Statement of Work
- **Stage:** 1 · **Effort:** S · **Module:** ui · **Depends on:** HARN-2 · **Risk:** low
- **Files:** new `tests/regression/sow-pdf-golden.test.ts` + baseline JSON; `src/lib/pdf/sow-pdf.tsx`; pattern from `tests/regression/quote-pdf-golden.test.ts` and `tests/helpers/quote-pdf-fixtures.ts:313`
- **Change:** The quote and contract already have byte-hash golden gates that render real PDFs in
  Node (measured: 3.40s for five renders). The SoW is the only document without one. Add it using
  the existing `normalizePdfBytes` helper and the same re-baseline flow.
- **AC:** A change to SoW rendering that alters the output fails a named test. The re-baseline flow
  is documented in the test file. Runs in under 5s.

### HARN-4: Make the pipeline suite a required gate
- **Stage:** 1 · **Effort:** S · **Module:** factory · **Depends on:** HARN-3 · **Risk:** medium — a flaky gate blocks every PR
- **Files:** `.github/workflows/ci.yml` (the `gate` job, :36-49)
- **Change:** Run `npm run test:pipeline` in the `gate` job. The Engineer and QA agents already
  refuse to proceed on a red `gate`, so this reaches the factory's Verifier without touching branch
  protection.
- **AC:** A PR that regresses price fidelity against a fixture cannot go green, and the failure
  names the fixture and the stage. The gate adds under 60s to CI. Three consecutive green runs on
  `main` before the item is called done.

---

## Stage 3 — production readiness

### OBS-5: Sentry on the app and the Capacitor shell
- **Stage:** 3 · **Effort:** M · **Module:** app · **Depends on:** OBS-1 · **Risk:** low
- **Change:** Sentry on Next.js and the iOS shell, with `run_id` as a tag. Catches the crash class
  the fixtures cannot. Smaller than it sounds — the defects found in this review are content bugs,
  not exceptions — but necessary once testers are neither in Norfolk nor on the phone to Jacob.
- **AC:** A deliberate crash in a preview deploy appears in Sentry within 60s, tagged with its
  `run_id`. Crash-free session rate is reportable.
- **Status:** Backlog. Sequenced after Stage 0/1; not queued yet.

### OBS-6: Stop the stepper showing a tick for something that did not happen
- **Stage:** 3 · **Effort:** S · **Module:** ui · **Depends on:** — · **Risk:** low
- **Files:** `src/lib/job-stages.ts:160-234` (`deriveStages`, forcing at :221-227), `src/app/jobs/[id]/page.tsx:277-284`, `src/components/ui/pipeline-stepper.tsx`, `src/lib/job-history.ts:180`
- **Change:** `deriveStages` rewrites an incomplete earlier stage to `"complete"` and the stepper
  renders it as ticked, so a contractor sees `contract_signed` complete when no contract was
  signed. The event is emitted and consumed by nothing. Show the forced stage as *forced* rather
  than complete.
- **AC:** A job invoiced before its contract was signed renders that stage visibly distinct from a
  genuinely complete one. `AGENTS.md`'s rule holds: the signal reaches the user, not only `events`.
- **Correcting the brief:** P-2 said this "has reported itself seven times". Production shows **7
  firings across 2 distinct jobs**, always `forced_stages: ["contract_signed"]`, re-fired on every
  server render. And its canonical trigger — invoicing before a contract — is a legitimate
  workflow the six-stage model is too rigid for, per `src/lib/job-stages.test.ts:146-159`. This is
  a display bug, not a data-corruption bug.
- **Status:** Backlog.

---

## PFIX — defects in the shipped price-fidelity chain

**Not queued for the factory. Backlog, pending Jacob's decision.**

`AGENTS.md`: *"Money. Fees, pricing… anything affecting what a contractor or customer is charged"*
escalates to a human always, regardless of confidence. The brief's own D12 recommends Stage 2 by
hand with the Verifier gating it. Every item here changes what a customer is charged, and the
Verifier that would gate them (`HARN-4`) does not exist yet. Each was reproduced by executing the
real modules — evidence is in `docs/robustness-review-findings.md` §11.

| ID | Defect | Severity |
|---|---|---|
| **PFIX-1** | `extractStatedPrices` parses `"between eight hundred and a thousand"` as **£801,000.00** and marks it chargeable (`stated-prices.ts:196`, `parse-spoken-money.ts:91-97`). `"two and a half grand"`, `"three twenty and… one eighty"`, `"twenty two fifty a square metre"` all return `[]` — the price is silently lost. Only one amount per sentence is ever extracted, and sentences split on `.!?` only, so an unpunctuated ASR turn merges with the next. No per-day / per-hour / per-m² / approximately / plus-VAT / range concept exists. | **Critical** |
| **PFIX-2** | Speaker labels are discarded. If the assistant reads a figure back wrong, the contractor's £520 is marked `superseded_by` the model's misheard £250, **and the model's figure becomes chargeable**. `conversation_json` holds the labels and is never consulted. | **Critical** |
| **PFIX-3** | `matchStatedPrice` falls back to matching on one shared word of ≥3 characters with no stop-word removal (`compile-draft.ts:487-492`). Reproduced: one stated £520 written onto three unrelated lines, one of which matched on the word **`and`**. | **High** |
| **PFIX-4** | A locked price is **inert on labour lines**. `applyStatedPrice` sets `unit_price` and `quantity: 1` but leaves `people` intact, and `lineItemTotal` prefers `people` (`quote-math.ts:12-15`). Measured: locked £520 still charges £600. | **High** |
| **PFIX-5** | The first-run invention guard is off for essentially every account. `hasPricingHistory` returns true if `similarPastJobs` is non-empty, and `match_knowledge_chunks` has no `source_type` filter and no similarity threshold (migration 7:12-16), so one business-setup chunk satisfies it. Every contractor-supplied material line is then priced from a model estimate, marked up. Measured: £180 → **£216.00 printed as a real price**. Defeats the 1 Sep decision in `areas/motko.md`. | **Critical** |
| **PFIX-6** | Invented figures feed themselves: `syncQuoteKnowledge` embeds the drafted breakdown **before any human sees it**, and it returns as `similar_past_jobs` in the next draft's prompt. | **High** |
| **PFIX-7** | Redefine the invention-rate metric. Draft-vs-final cannot be used. Use `quote_line_edits` `modified` rows, and fix its four limits: written only on send, does not exclude null-mode collapses, matches on exact normalised description so a rename reads as remove+add, and its `normalize()` disagrees with the stored generated column (migration 14:17). | **Medium** — blocks any ship gate |
| **PFIX-8** | Retire three dead paths, all from the same removed July feature: `jobs.source_audio_url` (no writer) and the `voice-notes` bucket, which holds **21 objects, 4.6 MB, 10–12 Jul, one owner folder**, still swept by `account-erasure.ts:43`; and the orphan tables `client_errors`, `feedback`, `rate_limits` — no migration, no writer, and **seeded into `src/checks/public-surface.json` by the very commit that created the drift check** (`4cf6756`), so the check is permanently green over them. **Irreversible — needs Jacob.** The 21 recordings may be worth keeping as `HARN-1` fixture material. | **Medium** |
| **PFIX-9** | Smaller, real: reconciliation flags accumulate rather than replace (`stated-price-guard.ts:205-209`); `UNRESOLVED_RATE_FLAG`/`UNSOURCED_PRICE_FLAG` are never cleared by an edit so a send stays blocked after the contractor fixed it; the editor has no concept of `unpriced`; `setQuotePricingMode`'s `sow_json` write is unchecked (`actions.ts:878`); a fixed-mode quote with any stated price can be unsendable through the UI. | **Medium** |

---

## Not a ticket — the question that outranks all of them

In August, **17 of 18 jobs were typed by hand** and one voice session ran all month, after a **41%
mid-call abandonment rate in July**. Nine of twelve contractors have tried voice at least once.

No ticket here fixes that, and no instrumentation is needed to start: nine people can be asked why
they stopped. `OBS-1` makes the answer measurable from then on, which is why it is first — but the
conversation should not wait for it.
