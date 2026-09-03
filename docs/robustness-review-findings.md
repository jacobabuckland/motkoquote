# Pass B — adversarial verification of the robustness brief

**Read against:** `main` @ `f4947aa`, on branch `claude/new-session-p832ph`. Code evidence is
`f4947aa`; production evidence was queried live on 2 Sep 2026 against project
`ldapggtjnvjnabvzcebj` (read-only connector).

**Method.** Three independent agents verified the claims against the code with no access to
production; the production re-measurement was run separately and fed back to them mid-flight.
Where code and data disagreed, both were re-checked before a verdict was written.

**Capability notes.**
- The **git history is unusable before 30 Aug 2026.** `e81b8fe` is the repository's root commit
  (no parents, 852 files, 147,259 insertions). Every `git log -S` line of enquiry the brief
  suggested is inconclusive by construction. Nothing below rests on git archaeology.
- The Supabase MCP connector **was** available to this session (the subagents reported it
  unauthorised from theirs, so their "could not determine" items are closed here, in §8).

---

## 0. The one-paragraph answer

**The brief's Stage 2 has already shipped.** R1–R5 are, item for item, the factory's `PRICE`
programme, merged between 28 and 31 August — six days before the brief was written. Its author
could not see the repository and proposed rebuilding work that was already on `main`.
**The 55% invention rate that justifies the whole plan is invalid**: 20 of its 23 quotes predate
the fix, and the draft-vs-final diff it is computed from does not measure user rejection at all.
**Stages 0 and 1 survive and are the right work** — but the reason has changed. It is no longer
"find out why the model invents prices"; it is "nobody can tell whether the fix worked, and
organic volume will never tell them." Separately, verification turned up **six live defects in
the shipped price-fidelity chain**, two of which put materially wrong money on customer
documents today. Those are in §7 and none of them is in the brief.

---

## 1. B1 — "Prices never become structured data"

### VERDICT: **WRONG** — all three assertions are false.

The claim was that a stated price has nowhere structured to live between transcript and drafting
model, existing only as free text in `jobs.transcript`, which the drafting model re-reads.

**Structured money exists in two independent places before drafting.**

1. *During the call.* `SOW_DELTA_TOOL_PARAMETERS` (`src/lib/schemas/sow.ts:334`) exposes typed
   numeric fields to the realtime model — `agreed_costs.day_rate`, `agreed_costs.fixed_price`,
   `agreed_costs.deposit_amount` (`sow.ts:419-429`) and `pricing.fixed_amount` (`sow.ts:434-449`).
   They arrive via `update_sow` → `saveSowDelta` (`src/app/jobs/actions.ts:303-321`), validated by
   `agreedCostsSchema` (`sow.ts:102-107`) and `pricingSchema` (`sow.ts:137-142`).
2. *After the call, deterministically.* `src/app/jobs/actions.ts:408` runs `extractStatedPrices`
   and persists the result to `sow_json.stated_prices` at `:416`, in integer pence
   (`src/lib/schemas/stated-price.ts:22-34`). This write precedes drafting at `:468`.

**The drafting model never sees the transcript.** `draftQuoteLineItems` sends exactly one user
message: `JSON.stringify({ job: extraction, contractor })` (`src/lib/claude.ts:184`). Neither
`JobExtraction` (`src/lib/schemas/job.ts:19-38`) nor `ContractorContext` (`claude.ts:56-77`)
carries a transcript field. `jobs.transcript` is written once (`actions.ts:461`) and read by no
drafting path.

**The structured prices are consumed.** `getChargeableStatedPrices` (`stated-prices.ts:434-447`)
filters superseded/paid/excluded, and the survivors are interpolated into the system prompt as an
explicit locked-price block (`claude.ts:98-116`) and passed as the fourth argument to
`compileDraftToLineItems` (`actions.ts:492-511`).

**Schema comparison.** The brief proposed `stated_prices[]` with `amount`, `attaches_to`,
`transcript_span`, `qualifiers`, `superseded_by`. What exists has `amount`, `item` (the brief's
`attaches_to`), `transcript_span`, `qualifiers {each, fitted, already_paid, excluded}`, and
`superseded_by`. It is the proposed schema, with one field renamed.

**On the empty lookup tables.** The brief's `material_prices` is not the table the code uses —
that is `contractor_material_prices` (`src/lib/materials.ts:56`). `material_prices` is an orphan.
The consequence of an empty lookup is set out in §7.3, and it is worse than the brief guessed.

**Is the model given prices, told to infer them, or both? Both** — see §7.4.

---

## 2. B2 — "There is no provenance on line items"

### VERDICT: **PARTLY WRONG** — provenance is written, persisted, and gates the send. But it is
never shown to a human, and the "span" is not a span.

`lineItemProvenanceSchema` (`src/lib/schemas/job.ts:56-64`) is `{ source: "transcript" |
"contractor", transcript_span?: string }`, attached at `job.ts:121-125`. It has **five write
sites**: `compile-draft.ts:517-520` (applied at `:531`/`:542`) for transcript-sourced lines, and
four contractor-sourced sites in the editor (`quote-editor.tsx:312`, `:335`, `:808`, `:509-513`).
It is cleared for unmatched lines at `compile-draft.ts:621`.

**It is a hard gate, not telemetry.** `reconcileStatedPrice` (`src/lib/stated-price-guard.ts:155-163`)
fails any non-provisional line lacking `provenance.source`, and `sendQuote` throws on the result
(`actions.ts:1166-1196`). Confirmed live: a 1 Sep production quote carries provenance on 2 of 2
lines.

**Where the claim is right in effect.** Provenance is never rendered — no hit in `src/lib/pdf/*`
or `src/app/q/[id]/*`, so no human sees which line came from where. `transcript_span` stores the
whole sentence (`stated-prices.ts:225`), and on an unpunctuated transcript that is the entire
transcript; there are no offsets, no turn id, no speaker. Coverage is exactly co-extensive with
`matchStatedPrice`, so a job whose extraction returns `[]` gets no provenance at all and the gate
never fires (`stated-price-guard.ts:136-140`). And it is destroyed in fixed mode
(`pricing-mode.ts:44-56`).

**`assumed` / `provisional` / `unpriced`, as asked.**

| Field | Set at | Means | Consumed by |
|---|---|---|---|
| `assumed` | `compile-draft.ts:333,346,381,420,439` | "a proposal, not a confirmed rate" | **Display only.** No gate. Cleared by `applyStatedPrice` (`:527`,`:540`) |
| `provisional` | `compile-draft.ts:420,441` | an editable placeholder sum | Kept out of the fixed-mode collapse (`pricing-mode.ts:87`); **excluded from both reconciliation checks** (`stated-price-guard.ts:74,107,151-153`) |
| `unpriced` | `compile-draft.ts:244,335,423,619` | the amount is **absent**, not zero | Customer HTML, PDF, acceptance refusal (`q/[id]/actions.ts:44`), both send blocks (`actions.ts:1103,1115`) |

`unpriced` is the only one with real machinery and is the natural carrier for an extension — but
two defects must be fixed first (§7.5, §7.6).

---

## 3. B3 — "55% of drafted lines are deleted by users" (highest priority)

### VERDICT: **WRONG.** The metric measures a code transformation, not user rejection. It should
be reported as invalid, not caveated.

### The distribution settles it before any code is read

All 23 quotes holding both a draft and a final version, as `drafted → final : quotes`:

```
18→1:1  11→1:1  9→9:1  8→1:1  7→1:2  6→6:1  6→1:1  5→5:1  5→1:1
 4→4:2   4→1:1  3→3:1  3→1:1  2→2:2  2→1:1  1→1:1  0→2:1  0→0:3
```

**Perfectly bimodal.** Every quote either has `drafted == final` exactly, or collapses to exactly
one line. There is not a single partial deletion — no 8→5, no 6→4. Ten collapsing quotes carry
essentially all 59 "deleted" lines; the other thirteen contribute **zero**. A metric where every
observation is 0% or ~90% is a boolean reported as a percentage.

### What each of the ten collapses actually was

Resolved by joining to `jobs.sow_json`, `quote_line_edits` and the final line's description:

| Date | drafted→final | mode | edit rows | Cause |
|---|---|---|---|---|
| 14 Jul | 18→1 | null | **18** | **Genuine hand deletion** — the only one |
| 27 Jul | 7→1 | fixed | 0 | Fixed-mode collapse |
| 12 Aug | 3→1 | fixed | 0 | Fixed-mode collapse |
| 13–26 Aug | 7→1, 2→1, 8→1, 5→1, 11→1, 6→1 | null | 0 | Legacy collapse (below) |
| 1 Sep | 4→1 | fixed | 0 | Fixed-mode collapse |

The six August rows have `sow_json` **entirely null**, no transcript and no extraction — a
combination the current tree cannot produce, since `completeSowConversation` writes all four in
one statement (`actions.ts:453-467`). Their surviving line reads *"Rewire works — see Scope of
work"*, *"Downlights works — see Scope of work"* — the `" — see Scope of work"` suffix is
`deriveWorksDescription` (`src/lib/pricing-mode.ts:30`). So they are fixed-mode-shaped collapses
produced by code that predates the squashed history and is no longer in the tree. That matches
`applyPricingMode`'s own comment: *"Legacy jobs: pricing was never set (pre-Task B)"*
(`pricing-mode.ts:79-81`).

**Nine of the ten collapses were code. One was a human.**

### Why the two columns can never be differenced

They are two views of one computation, written in a single insert (`actions.ts:561-567`):
`line_items_json` is `applyPricingMode(calculatedLineItems, …)` and `drafted_line_items_json` is
`calculatedLineItems`. They are already unequal at *t=0* for every fixed-mode quote, with no human
involved. **The codebase already knows this** — `actions.ts:1203-1210` excludes fixed mode from
its own edit-recording with the comment *"a diff would be pure noise (the contractor never saw or
edited the breakdown)"*. The 55% was computed over precisely the rows production code deliberately
excludes.

Two further contaminations: **four of the 23 quotes are `createManualJob` rows** — hand-typed,
never AI-drafted, inserted with `drafted_line_items_json: []` (`actions.ts:196-202`), which is not
null and so passes an `IS NOT NULL` filter. And several transformations that *do* drop lines sit
**inside** the baseline and are invisible to the diff: the labour merge N→1
(`compile-draft.ts:568-581`), `already_paid`/`excluded` drops (`:509-512`), and the `fitted`
merge (`:626-628`).

Confirmed not to be causes: `applyAgreedDayRate` and `applyAgreedFixedPrice` are pure `.map()`
(`agreed-costs.ts:16-29`, `:53-65`) and run *before* the baseline is stored; the third argument to
`applyPricingMode` only appends a string to the works description (`pricing-mode.ts:30,89`); and
`updateQuoteLineItems` applies no server-side filtering, dedup or validation (`actions.ts:1009-1017`).

### The replacement signal

`quote_line_edits` is better but not clean, with four limits: it is written **only on send**
(`actions.ts:1211-1215`), so an unsent quote contributes nothing and the writer swallows failures
(`quote-learning.ts:120-122`); it excludes fixed mode but **not** null mode (`actions.ts:1207-1209`),
so it inherits the same contamination; it matches on exact normalised description
(`quote-learning.ts:32-33`), so a rename reads as remove + add, making `removed` an upper bound;
and the matcher's `normalize()` disagrees with the stored generated column
(`migration 14:17`), under-counting recurring tendencies.

**The one clean signal available today** is the `modified` rows: a price, quantity or multiplier
delta on a line the contractor *kept* (`quote-learning.ts:54-72`) cannot be produced by any code
path. In production `quote_line_edits` holds 21 rows, all 14–30 July, none since.

**If the metric must be salvaged:** exclude `jsonb_array_length(drafted_line_items_json) = 0`
(drops 4 manual jobs), exclude `pricing->>'mode' = 'fixed'`, and verify any remaining collapse was
hand-made. That leaves ~15 quotes, of which 8 or 9 show *zero* deletions. A defensible reading of
the same data is that drafted lines are being kept almost universally.

---

## 4. B4 — "Trace writes are opportunistic"

### VERDICT: **PARTLY WRONG.** Right for `conversation_json`, wrong for the rest. The dominant
gap is rows that were never eligible for a trace.

`extracted_json`, `sow_json` and `transcript` are written **together, once, by one statement**
(`actions.ts:453-467`) — the opposite of opportunistic. The coverage gap decomposes as:

- **Abandoned sessions.** `createRealtimeSession` inserts the job row at `actions.ts:134-136`
  with `status: "sow_in_progress"` **before** the client secret is minted (`:159`) and long before
  anyone speaks. A denied microphone or a closed tab leaves a permanent trace-free row. Production:
  **11 such rows, all July — a 41% mid-call abandonment rate that month.**
- **Manual jobs.** `createManualJob` (`actions.ts:190-192`) inserts `status: "drafted"` with no
  transcript, by design. Production: **27 of the 42 `drafted` jobs have a null transcript.**
- **Seeded rows** (`scripts/seed-demo-contractor.ts:166-176`).
- **A genuine lossy tail.** The trace write sits *after* the `Promise.all` at `:424-446`, which
  contains `generateSowNarrative` — an Anthropic call with **no try/catch of its own**, unlike its
  three siblings which swallow failures. One rate-limit rejects the whole block and
  `completeSowConversation` throws before writing anything. The recovery path,
  `saveVoiceTranscript` (`:928-934`), writes `transcript` and `conversation_json` but **not**
  `sow_json` or `extracted_json` — exactly the shape that leaves `transcript` > `extracted_json`.
- **Neither write is error-checked.** `:453` and `:928` are bare `await …update(…)` with no
  `error` destructure, while the quote insert beside them is guarded.

**The empty-string risk is real in code but has not occurred.** `transcript: transcript ?? null`
(`:459`) receives `transcriptRef.current.join("\n")`, and `[].join("\n")` is `""`, so a wrapped
call with zero transcription events would write an empty string. Production: **zero empty strings
in all 58 rows.** Not a live defect; still worth a guard.

**`source_audio_url` has no writer — and the reason is now known.** Nothing in `src/`, `scripts/`,
`supabase/`, `ios/`, `native/` or `tests/` writes it. But
`supabase/migrations/00000000000004_voice_notes_storage.sql:2` creates a private `voice-notes`
bucket with `auth.uid()`-scoped RLS, and `src/lib/account-erasure.ts:43` still sweeps it
(`OWNED_BUCKETS = ["voice-notes", "logos", "receipts"]`). **The bucket holds 21 objects, 4.6 MB,
all dated 10–12 July 2026, under a single owner folder.** Only 5 jobs carry a
`source_audio_url`, so 16 are orphaned. This is the storage half of a removed feature, still live
in production and still swept on erasure. See ticket OBS-5.

---

## 5. B5 — "`conversation_json` has two writers under two incompatible schemas"

### VERDICT: **WRONG** on both halves.

**One shape, two writers, zod-enforced.** Both writers are in `actions.ts` (`:463`, `:931`) and
both write `TranscriptTurn[]` = `{ speaker, text, at }` (`voice-transcript.ts:20-25`), taken
through `transcriptTurnsSchema` (`:328`, `:906`) — a `{role, text}` element could not be written
even if a caller supplied one. Neither is dead code.

**The production data proves these are eras, not rivals:**

| Shape | Elements | Jobs | Date range |
|---|---|---|---|
| `{role, text}` | 28 | 5 | **10–12 Jul 2026** |
| `{at, speaker, text}` | 13 | 1 | **1 Sep 2026** |

One retired shape and one current shape, eleven weeks apart. There is no live incompatibility and
nothing to reconcile — at most a one-off migration of 28 elements, and arguably not even that.

**The 52 empty arrays are a column default.**
`supabase/migrations/00000000000009_conversational_sow.sql:4` declares `conversation_json jsonb
not null default '[]'::jsonb`. The column *cannot* be null; every row was `[]` at insert. "52 of
58 empty, mean length 0.7" is exactly what *never written* looks like, and carries zero
information about the writers.

**A related inaccuracy in Pass A.** The map said a call without turns "leaves the column
untouched". It does not: `conversationTurns` is non-optional in the adapter
(`job-intake-adapter.ts:23`) and every caller passes a ref initialised to `[]`, which is truthy,
so `...(conversationTurns ? … : {})` always takes the true branch and writes `[]`. The guard's
stated purpose is not achieved for any caller in this tree.

---

## 6. B6 — "The reporting tables are RLS-blocked"

### VERDICT: **WRONG.** RLS blocks nothing because nothing ever inserts. These are orphan tables —
and the check built to catch exactly this class was seeded blind over them.

`client_errors` (1 row) and `feedback` (0 rows) have no migration and no writer. Confirmed against
all 62 migrations: neither appears in any `create table`, nor does `rate_limits`.

**They are not "zero references", and Pass A was wrong to say so.** All three appear in
`src/checks/public-surface.json` — lines 13, 24 and 37. Pass A's grep looked only for Supabase
call sites (`\.from("…"`) and missed the manifest. That file is read by
`src/checks/object-inventory.check.test.ts`, which fails in both directions against a live RPC, so
their presence in the manifest is positive evidence they exist on production.

**The finding that matters.** All three entered the manifest in one commit — `4cf6756`,
*"Check production's function privileges and object inventory (#484)"*, 1 Sep — the commit that
*created* the drift check, in response to `settle_fee_collection` being *"in no migration and
called by no code"*. The initial manifest was seeded from a live production snapshot. So **three
pre-existing orphans of precisely the class the check exists to detect were written into its
baseline and permanently silenced.** The check is green over them and always will be. This is a
more serious problem than the one B6 alleges: the drift check has a blind spot equal to whatever
was already wrong on the day it was installed.

**`rate_limits` is worse than orphaned.** `src/lib/rate-limit.ts:33` is an in-process
`Map`, described in its own header as *"deliberately a process-local fixed window"*. No
`from("rate_limits")` exists anywhere. The production table is not the rate limiter's store.

**`cron_locks` is correct.** Created by migration 28, RLS enabled with no policies by migration 39
whose header states the policy-less state is the intent. Every accessor takes an `admin` client
(`cron-lock.ts:14,33`), and service role bypasses RLS. The advisor flag is a false positive.

**Where client errors actually go: almost nowhere.** All three error boundaries
(`src/app/global-error.tsx:17`, `src/app/error.tsx:18`, `src/app/jobs/new/error.tsx:20`)
`console.error` and stop. No `ErrorBoundary` class, no `componentDidCatch`. The only
client-originated error path in the tree is `reportRealtimeConnectFailure`
(`src/app/actions.ts:32-39`) → `logError` → `track("error")` → the `events` table. Every
render-phase crash is console-only — invisible in a WKWebView with no inspector attached. **That
is the real gap B6 was groping at, and O2's "fix the RLS policies" would not have closed it.**

---

## 7. B7 — `stepper_inconsistency`

### VERDICT: **PARTLY WRONG.** Real signal, wrong description, and the count overstates it ~3.5×.

**What it detects.** `src/app/jobs/[id]/page.tsx:277-284` fires when
`deriveStages` (`src/lib/job-stages.ts:160-234`) finds the six-element completion vector
`["quote_sent","accepted","contract_signed","work_complete","invoiced","paid"]` (`:85`) is
**non-monotonic** — a later milestone complete while an earlier one is not. Each flag is read from
a different row family (`:176-206`). It is not two systems disagreeing about one job; it is one
derivation over four row families that need not line up in pipeline order.

**Its canonical trigger is legitimate.** The source comment (`:211-213`) and the only test
(`job-stages.test.ts:146-159`) both name it: a contractor who raises an invoice before the
contract is signed. That is an ordinary way to run a job. Production confirms it —
**7 firings across only 2 distinct jobs, with `forced_stages` always exactly `["contract_signed"]`.**
One condition, two jobs. The page is a server component and `track` sits in the render body with
no dedupe, so it re-fires on every render; "seven times" is an upper bound on renders, not jobs.

**It terminates in telemetry, and the user is actively misled.** `stepper_inconsistency` appears
in exactly one place repo-wide — no consumer, no alert, no test. Worse, `deriveStages:225-226` has
already rewritten the forced stages to `state: "complete"` before render, and
`pipeline-stepper.tsx` has no inconsistency affordance. **So the contractor is shown a tidy,
fully-ticked stepper in which `contract_signed` reads as complete when no contract was signed.**
`job-history.ts:180` discards `inconsistentStages` entirely for the dashboard.

This is a direct instance of the standing `AGENTS.md` rule — *"A signal that must change behaviour
cannot terminate in telemetry."* The signal changes what the user is shown, and reaches no human.

**Its properties are insufficient.** `job_id`, `quote_id`, `situation`, `forced_stages` — but not
the underlying row values that caused it. Re-querying by `job_id` returns *current* state, so a
job that has moved on cannot be reconstructed.

---

## 8. B8 — Stage 1 feasibility

### VERDICT: **PARTLY WRONG.** Two days holds for the half the plan describes. It does not hold
for the half the plan omits, and that half should be estimated separately rather than absorbed.

**The guest path is genuinely pure — verified by graph walk, not by reading the comment.**
Resolving every specifier transitively from `src/lib/guest/quote.ts` yields 24 internal modules
and 4 external packages, with **zero** Supabase, **zero** `next/*`, zero `server-only`, zero
`node:fs`. `sowToExtraction` (`sow.ts:901`) and `compileDraftToLineItems` (`compile-draft.ts:546`)
are pure. **Correcting Pass A:** `extractStatedPrices` *is* already inside that graph (via
`schemas/sow.ts` → `schemas/stated-price.ts`); the guest path simply has no transcript to feed it.

**Rendering is largely already built — Pass A was wrong to say no golden files exist.**
`tests/regression/quote-pdf-golden.test.ts` and `contract-pdf-golden.test.ts` are working
byte-hash golden gates that render real PDFs in Node against committed `.json` baselines, with a
deliberate `UPDATE_QUOTE_PDF_GOLDEN=1` re-baseline flow. `tests/helpers/quote-pdf-fixtures.ts:313-340`
already solves normalisation (timestamps, `/ID`, object ordering), and
`tests/regression/guest-quote-pdf.test.ts:12-34` has a working PDF text extractor. Measured:
**3.40s for 5 full PDF renders.** Rendering is not a cost centre. **Only the SoW lacks a golden.**

**Model record/replay does not exist and must be built.** The established pattern is
`vi.doMock("@/lib/claude", …)` with hand-written literals — stubbing, not replay. There is **no
HTTP mocking library** in `package.json` (no nock, msw, polly, undici MockAgent) and **no vitest
snapshots anywhere** in the repo. The right seam is easy, though: `src/lib/claude.ts:8` constructs
the Anthropic client lazily per call, so a module-boundary mock needs no env var and no
import-order care.

**The gap the plan does not name: there is no transcript → `SowState` function.** The SoW is
assembled *during* the call by `saveSowDelta` from realtime tool calls. In
`completeSowConversation` the transcript is used for exactly two things — `extractStatedPrices`
and persistence. `draftGuestQuote` takes `sow: SowState` as a parameter. **A harness fed a
transcript string produces nothing.** It must fixture a hand-authored `SowState` per scenario.

That matters twice over. It is unestimated work per fixture, and it means the harness **cannot
test the SoW-building stage at all** — the stage most exposed to model drift. Closing that needs
recorded realtime tool-call sequences replayed through `saveSowDelta`, which is a second project.

**And the existing fixtures are not what F1 assumes.** `fixtures/fenland-bathroom.md` is a prose
summary of spoken facts, not a verbatim transcript; `src/lib/fixtures/fenland-bathroom.ts` is a
`DraftLineItem[]` + `CompileContext`, i.e. it starts *after* the LLM. **The repo contains zero
transcripts.** Production holds 19, from 9 contractors, averaging 777 characters — but only 11 are
substantial (>500 chars) and **only one carries a `stated_prices` baseline**, so every expected-output
file must be hand-authored.

**Two corrections to the plan's own wording:** the repo is **npm**, not pnpm, and there is no
`test:pipeline` script — `pnpm test:pipeline` is wrong on both halves. And "full suite under 60s"
is ambiguous: a new pipeline-only project lands far under it (measured 2.86s for the four relevant
files), but the existing `npm test` is 124.79s and speeding that up is an unrelated project.

**`DRAFTING_TEMPERATURE` is 1.0** (`src/lib/models.ts:33`), so a re-record is not reproducible.
The cassette *is* the contract, and drift detection has to be a human review step.

---

## 9. B9 — the three stated unknowns, closed

| Unknown | Answer |
|---|---|
| **Current CI job list** | `ci.yml` runs 8 jobs. `gate` (typecheck → lint → `npm test` → generated-language check → build) plus `cross-branch-collisions`, `secret-scan`, `migration-check`, `schema-in-tree`, `schema-drift-probe` on all PRs, and `acceptance-test-immutability` + `spec-immutability` on `factory/*` only. Fifteen further workflows drive the factory or run on cron. Branch-protection settings are not in the tree, but `factory-engineer.yml` and `factory-qa.yml` both refuse to proceed on a red `gate`, so it is enforced regardless. |
| **Does a test suite exist?** | Yes, and it is substantial: vitest, **291 files / 3,809 tests, all passing in 124.79s** (measured this session). 91 acceptance, 137 regression, 59 colocated, 5 unit, 3 integration (excluded from the default suite), plus 3 live production checks run on cron by `rls-check.yml`. |
| **How is the drafting prompt assembled?** | A TypeScript string literal concatenated at runtime in `src/lib/claude.ts:92-179`, in three parts: a fixed opener, a **conditional locked-price block** inserted only when `getChargeableStatedPrices()` is non-empty, and a fixed constraints/format block. Job data goes in the user message as JSON. **No prompt anywhere carries a version identifier** — the deployed commit is the only version. |

---

## 10. What production actually says

Measured 2 Sep 2026, read-only.

### The PRICE programme shipped before the brief was written

| Item | PR | Merged | Brief's equivalent |
|---|---|---|---|
| PRICE-1 extract spoken amounts into `stated_prices` | #420 | 28 Aug 21:07 | R1 |
| PRICE-2 draft from locked line items | #426 | 29 Aug 09:32 | R2 |
| PRICE-3 line-item provenance | #443 | 30 Aug | R3 |
| PRICE-4 per-amount reconciliation gate, blocking on send | #452 | 31 Aug 07:33 | R4 |
| PRICE-5 language and double-charge guards | #482 | 31 Aug 13:42 | R5 |

`SEQUENTIAL_PROGRAMMES` in `scripts/factory/admission-order.mjs:27` names `PRICE` and documents
the chain in exactly the brief's terms. **Stage 2 is not work to be scheduled. It is work to be
measured.**

### The 55% is a pre-fix measurement

| Era | Quotes | Drafted | Final | Deleted |
|---|---|---|---|---|
| Before PRICE-1 | 20 | 103 | 45 | 58 (56.3%) |
| After PRICE-5 | 3 | 4 | 3 | 1 |

Twenty of twenty-three quotes predate the fix. The post-fix sample is **four line items** — not a
number anything can be concluded from, in either direction.

### Voice intake has effectively stopped being used

| Month | Abandoned mid-call | Completed voice | Manual jobs | Abandonment |
|---|---|---|---|---|
| July | 11 | 16 | 9 | **41%** |
| August | 0 | 1 | **17** | — |
| September (2 days) | 0 | 2 | 1 | — |

In August, **17 of 18 jobs were typed by hand.** Nine of twelve contractors have tried voice at
least once; five have sent a quote. The brief read the trace gaps as lossy instrumentation. Two
thirds of jobs never entered the voice pipeline at all — there was nothing to trace.

**This outranks the 55%.** A 41% mid-call abandonment rate in July, followed by near-total
abandonment of the feature in August, is the product's central problem, and no ticket in the brief
addresses it. It is also answerable this week without code, by asking the nine contractors why
they stopped.

### The PRICE chain is live and working

Two September voice runs: one extracted a `stated_prices` entry; the other carries **provenance on
2 of 2 line items.** The machinery does what it says.

### Telemetry

`quote_viewed` 12 (15–31 Aug), `stepper_inconsistency` 7 (16–25 Aug), `invoice_paid` 3 (16–24
Aug), `quote_created` 1 (1 Sep), `voice_session_completed` 1 (1 Sep). Two anomalies:
`invoice_paid` is emitted by **no code in the current tree**, and `quote_sent` **is** emitted by
current code yet has **zero rows** against 16 sent quotes — though the last send was 28 Aug and the
history is squashed at 30 Aug, so this may simply be tracking that postdates the last send. It is
not resolvable from the repo and OBS-3 should settle it.

---

## 11. Defects discovered during verification (none of these are in the brief)

These are in the **shipped** price-fidelity chain. Two put wrong money on customer documents.
All touch pricing, so per `AGENTS.md` none is admitted to the factory without Jacob's decision.

**11.1 — `extractStatedPrices` mis-parses ordinary trade speech.** Verified by executing the real
module. `"somewhere between eight hundred and a thousand"` → **£801,000.00**, marked chargeable
(`"a thousand"→"one thousand"` at `stated-prices.ts:196`, then `800 + 1` → `801 × 1000` at
`parse-spoken-money.ts:91-97`). `"two and a half grand"` → `[]` (whole price silently lost,
`:193`). `"Day rate's three twenty, and the mate's on one eighty"` → `[]`, both lost, because the
money-word run swallows the trailing `and` (`:113`). `"twenty two fifty a square metre"` → `[]`.
`"twenty five quid an hour"` → £25.00 as a flat line amount — there is no per-day, per-hour,
per-m², approximately, plus-VAT or range concept in the qualifier set at all. Only **one amount
per sentence** is ever extracted (`:203-228`), and sentences split on `.!?` only (`:185`) — so an
ASR turn without terminal punctuation merges with the next.

**11.2 — speaker labels are discarded, so the assistant can overwrite the contractor.**
`extractStatedPrices` takes the flat string, in which contractor and assistant turns are
interleaved. Verified: contractor says £520, assistant reads it back wrong as £250 → the
contractor's figure is marked `superseded_by: 25000` and **the model's misheard £250 becomes the
chargeable price.** `conversation_json` carries the speaker labels and is never consulted.

**11.3 — `matchStatedPrice` smears one price across unrelated lines.** `compile-draft.ts:449-495`
falls back to matching on **one** shared word of ≥3 characters (`:487-492`), with no stop-word
removal. Executed against the real compiler with the transcript *"The consumer unit is five
hundred and twenty pounds"*: the £520 was written onto the labour line, the consumer-unit line
**and "Twin and earth cable"** — which matched on the word **`and`**, present in "five hundred
**and** twenty". Subtotal £1,640 from one stated price. The send gate then blocks the quote.

**11.4 — a locked price is inert on labour lines.** `applyStatedPrice` sets `unit_price` and
`quantity: 1` (`compile-draft.ts:533-543`) but leaves `people` intact, and `lineItemTotal` reads
`people` as the source of truth when present (`quote-math.ts:12-15`). Measured: locked £520 on a
2-day owner line still charges £600. The lock is inert on the line kind it most often targets.

**11.5 — the first-run invention guard is off for essentially every account.** `hasPricingHistory`
returns true if *any* of known prices, rate cards **or `similarPastJobs`** is non-empty
(`pricing-history.ts:32-34`). `findSimilarPastJobs` calls `match_knowledge_chunks`, whose SQL has
**no `source_type` filter and no similarity threshold** (migration 7, lines 12-16; the comment at
`knowledge.ts:101-104` says so outright). A contractor who merely completed the business-setup
interview has a chunk, so `has_pricing_history` is `true` on their very first quote — and with
`rate_cards` and `contractor_material_prices` empty in production, **every contractor-supplied
material line is then priced from a number the model invented, marked up.** Measured: model
estimate £180 → **£216.00 printed as a real price**. This directly defeats the decision recorded
in `areas/motko.md` on 1 Sep (*"A first-run quote renders ungrounded prices as TBC, never as a
figure"*).

**11.6 — the invented figures feed themselves.** `syncQuoteKnowledge` (`actions.ts:576-585`)
embeds the *drafted* breakdown — including invented estimates — at draft time, **before any human
sees it** (`knowledge.ts:14-23` writes `"<desc>: <qty> <unit> @ £<unit_price>"`). Those figures
return as `similar_past_jobs` prose in the next draft's prompt (`claude.ts:152-153`).

**11.7 — the drafting prompt contradicts itself.** `claude.ts:92-96` states *"You NEVER set prices
or totals… Any price you were to invent would be discarded."* Fifty lines later `:137-141` asks
for `estimated_unit_cost_pence` and `:145-147` for `suggested_amount_pence`. Both are
model-authored numbers that reach `line_items_json`. The opening sentence is false for two of the
four line kinds.

**11.8 — a fixed-mode quote with any stated price can be unsendable.** Because
`provenanceChecksEnabled = statedPrices.length > 0` (`compile-draft.ts:559`), one extracted amount
zeroes every non-matching line and clears its provenance (`:614-622`), which then fails the send
gate. `buildFixedModeLineItems` constructs its single works line with **no provenance**
(`pricing-mode.ts:44-56`). The editor's `confirmContractorSourced` retry
(`quote-editor.tsx:503-528`) clears the first failure only; the second cannot be cleared without
adding a line to a fixed-price quote, which then breaks the fixed-amount check.

**11.9 — smaller, but real.** Reconciliation flags accumulate rather than replace
(`stated-price-guard.ts:205-209` filters on one prefix while `:188` joins all failure kinds).
`UNRESOLVED_RATE_FLAG` and `UNSOURCED_PRICE_FLAG` are never cleared by an edit, so a send stays
blocked after the contractor has fixed the prices, until a full `redraftJob`. The editor has **no
concept of `unpriced`** (zero hits in `quote-editor.tsx`), so a contractor who prices an unpriced
line leaves the flag set while the total silently includes it and the customer document still says
"To be confirmed". And `setQuotePricingMode`'s `sow_json` write at `actions.ts:878` is unchecked
while the quote write above it is fully guarded.

---

## 12. Corrections to the Pass A map

Recorded because Pass A is a committed artefact the factory reuses.

1. **§3/§5 — "no golden file covers the rendered quote, SoW or contract."** Wrong.
   `tests/regression/quote-pdf-golden.test.ts` and `contract-pdf-golden.test.ts` are working
   byte-hash golden gates. Only the SoW lacks one.
2. **§7.2 — "a call without turns leaves the column untouched."** Wrong. `[]` is truthy and every
   caller passes an array, so the conditional spread always writes.
3. **§7.3 — "`client_errors` and `feedback` appear in neither `src/` nor migrations."** Half
   wrong. They appear in `src/checks/public-surface.json:13,24`. The grep pattern only matched
   Supabase call sites.
4. **§7.11 — "what it does not cover: `extractStatedPrices`."** Wrong. It is inside
   `draftGuestQuote`'s import graph.
5. **§7.8** is right as far as it goes but stops short: `applyPricingMode` provably cannot have
   caused 7 of the 10 collapses, so fixed-mode collapse is not the whole story.

---

## 13. What survives of the plan

| Stage | Verdict |
|---|---|
| **Stage 0 — observability** | **Survives, re-prioritised.** O2 is rewritten (no RLS problem; the real gap is that every render-phase crash is console-only). O1 is rescoped (the gap is abandoned and manual jobs, not lossy writes). O4 becomes the *most* important item, because the funnel question — is voice failing or simply unused? — is now the product's central unknown. |
| **Stage 1 — fixture harness** | **Survives and is promoted.** It is the only way to measure whether PRICE worked, since organic volume produced 4 line items in 5 days. Estimate holds for the harness; fixture authoring and cassette recording must be estimated separately. |
| **Stage 2 — fix the root cause** | **Dropped as written.** R1–R5 shipped 28–31 Aug. Replaced by the §11 defect list, which is what is actually broken in the shipped chain. |
| **Stage 3 — production readiness** | **Survives, with P-2 rewritten.** `stepper_inconsistency` is 2 jobs and one legitimate workflow, not a seven-times defect; the bug is that the stepper shows a fabricated tick. P-4's invention-rate metric must be redefined before it can be a ship gate. |

**The exit gate the brief proposed for Stage 2 — "invention rate drops from 55% to under 15%" —
cannot be used.** The numerator was never measuring invention.

---

## 14. Corrections from Jacob, 3 Sep 2026

Two readings in §10 were wrong. Both came from inferring user behaviour out of row
counts without knowing what was being done to the system at the time, and the correction
came from the one person who did.

**14.1 — The July abandonment rate is not a user signal.** §10 read 11 job rows stranded at
`sow_in_progress` against 16 completed voice sessions as a 41% mid-call abandonment rate.
Those rows are **Jacob's own test runs that were incorrect**, not contractors giving up
mid-call. The figure should not be quoted, and `OBS-1` should not be justified by it. What
`OBS-1` is still for stands on its own: there is currently no way to distinguish a session
that never started from one that hung from one that completed, whoever the caller is.

**14.2 — The August collapse in voice usage was instructed, not organic.** §10 read
17 of 18 August jobs being typed by hand, with one voice session all month, as the product's
central unknown, and recommended asking the nine contractors why they stopped. **Jacob had
told them to stop** — he halted voice intake deliberately because of the errors it was
producing. There is no mystery to investigate and no question to put to the testers. The
recommendation is withdrawn.

The useful residue of both corrections is that neither number measured what it appeared to.
A tester cohort under active instruction is not a natural experiment, and row counts cannot
see the instruction.

**14.3 — The real defect underneath, which the review missed.** Jacob's account of *why*
he halted it: *"this is also the voice function cutting calls short and assuming they are
finished."*

Checked against production, and it holds. `scope_items` — the itemised scope the drafting
model is handed — is **derived** from `rooms[].work_items` by `sowToExtraction`
(`src/lib/schemas/sow.ts:901-905`), and real conversations are yielding almost none of it:

| Transcript | Rooms | Total work items |
|---|---|---|
| 2,232 chars | 1 | 5 |
| 2,157 chars | 2 | 2 |
| 1,819 chars | 1 | **1** |
| 1,109 chars | 1 | 3 |
| 1,024 chars | 3 | 3 |

(The July 10–12 rows showing 8–10 rooms and 10–24 work items against 28–196 character
transcripts are seeded demo data from the removed-feature era, not real calls.)

Two hard caps can end a call before the contractor has finished:
`MAX_ASSISTANT_QUESTIONS = 12` (`src/lib/schemas/sow.ts:1124`), incremented on **every**
`response.done` (`src/components/voice/job-intake.tsx:1115`) so an acknowledgement or a
read-back consumes one; and `MAX_SESSION_MS = 6 minutes` (`sow.ts:1125`). Either trips
`concludeOrAskRequired` (`job-intake.tsx:1136,1141`), which takes at most one compact
wrap-up detour for unanswered required slots and then drafts.

**And a cap ending is invisible to the contractor.** `wrap_incomplete` and
`unasked_required` flag only missing *required checklist slots* — crew, pricing mode,
materials supply. A call cut off mid-scope with those three answered is recorded as a clean
wrap, and the quote presents as finished. The wrap reason that would distinguish it reaches
the events table and nothing else, which is the same "signal terminating in telemetry"
pattern `OBS-6` covers for the stepper.

Ticketed as `VOICE-4`, queued Ready for factory at priority 1. Note the honest limit: thin
captured scope is consistent with a premature ending **and** with the model failing to
record work items it did hear. The card says so and asks for that to be settled on a live
call before the fix is committed to.

**14.4 — What this means for the plan.** It strengthens Stage 1 rather than changing it.
A defect that silently truncates scope is exactly what a fixture harness catches and what
no amount of production telemetry would have surfaced — the quotes looked complete, and the
only reason anyone knew otherwise is that Jacob listened to the calls.

---

## 15. Addendum 1 reconciliation (3 Sep 2026)

Addendum 1 takes precedence over the first brief where they conflict. What it changes here.

**15.1 — The 55% is withdrawn, and §3 of this document is superseded on the point.**
§3 already found the metric invalid because it measures a fixed-mode collapse rather than user
rejection. The addendum adds a second, independent reason: **two accounts produce 52 of the 59
deletions**, and excluding them moves the figure from 55.1% to 18.9%. Neither number is usable —
19% rests on 37 line items across 11 quotes, and the contractors showing near-zero edits mostly
never sent a quote, so they never reached the point of editing. **The historical data cannot
produce an honest invention rate at all.** Do not cite 55% anywhere.

**15.2 — Root cause of the contamination, which outlives this review.** The `contractors` table
has no test-account flag, so no metric in the product can exclude internal accounts. Every figure
in §10 of this document inherits that defect. They remain directionally useful for finding bugs
and are not valid as gates or priorities. Raised as `DATA-1`, which cannot be built until Jacob
identifies the accounts — `a3ab3baa` (23 jobs, 12 Jul – 30 Aug) and `b17a6f91` (20 jobs, 10–30
Jul) together hold 43 of the 58 jobs.

**15.3 — The ship gate is now fixture-derived and binary.** Replacing the 55%→15% target:

> Against the fixture set, **zero** line items carry a monetary value absent from the transcript.

No user population is required, which with voice switched off is the point. Price drift stays as a
monitoring metric, explicitly not a gate, until it can be computed on non-test accounts. The
14-consecutive-days production definition is unchanged in form but **cannot start accumulating
until voice is back on**.

**15.4 — B11 answered, and it narrows PFIX-4 rather than widening it.** §A4 asked whether any
authenticated path also leaves `has_pricing_history` unset. Enumerated:

| Caller | Sets it? |
|---|---|
| `src/app/jobs/actions.ts:492` `completeSowConversation` | Yes, `:502` |
| `src/app/jobs/actions.ts:708` `redraftJob` | Yes, `:718` |
| `src/lib/guest/quote.ts:125` | **No** — left `undefined` |

The `undefined` fall-through is guest-only, so this is **not** the August £520→£600 mechanism
reached by another route. But it splits the ticket in two rather than shrinking it: the guest path
never sets the field, *and* `hasPricingHistory` (`src/lib/pricing-history.ts:32-34`) is satisfied
by any non-empty `similarPastJobs`, which one business-setup chunk provides. The second half is
customer-facing. Both must land together.

The shape worth naming: `has_pricing_history` is an **optional** field tested with `=== false`, so
omission silently means permissive. A guard whose default is the unsafe branch will keep finding
new callers to catch out.

**15.5 — §A6 accepted: the intake non-goal is reopened, and the harness gap is a real fault in
this review's own plan.** HARN fixtures start from a hand-authored SoW, so the harness is
structurally blind to the conversation stage — which is where the defect that halted the product
lives. A Verifier that cannot catch the bug that stopped the product is not yet the Verifier the
plan claimed. The addendum's reframe is correct and worth adopting: recording a Realtime session
is the *same first step* as the VOICE-4 diagnosis, so it should be priced as one step rather than
deferred as a second project. Capture once, use twice — the diagnostic input and the seed of the
first conversation-layer fixture. This authorises capture and test, not an intake redesign.

**15.6 — A defect in the factory itself, found while acting on the above.** The queue stalled with
everything blocked and nothing in progress, and the cause was not any ticket:
`scripts/factory/check-acceptance-run.sh` was rejecting correct acceptance tests. Vite phrases an
unresolved import as `Failed to resolve import "x" from "y"`, which matched none of its patterns,
so it reported "the log names no unresolved import" while the log named one in full; and its
`## Files` filter excluded square brackets, so in an App Router repository no dynamic-route file
could ever be declared. Three derivations were destroyed by it (#522 twice, #521 once). Fixed and
merged as `7875421`.

Worth generalising, because this is the third check found reporting a violation that cannot occur
— the others being `schema-in-tree` on jsonb paths, and `check-acceptance-static` having no view
of `supabase/`. **A check whose pattern list silently means "the phrasings we happened to have
seen" fails closed on correct work**, and the factory's own gates have cost more cycles this week
than the defects they exist to catch.

---

## 16. The real-user population, isolated (3 Sep 2026)

Jacob classified the accounts, which for the first time allows internal activity to be separated
from contractor activity. `a3ab3baa` — the erased account holding 23 jobs and 49 of the 107 drafted
line items — was his, erased on 1 Sep while testing the erasure flow. Internal accounts are
therefore `a3ab3baa`, `cdde5c02`, `2be6303a`, `fa19d011`, `f6baf2e8`; `1d424ada` and `4aa3996d` are
neither internal nor working tradespeople and hold one job and no sent quotes between them.

### 16.1 — There has been no real-user activity since July

Excluding internal accounts, every job on production by month:

| Month | Jobs | Voice | Abandoned mid-call | Contractors |
|---|---|---|---|---|
| July 2026 | 25 | 13 | 10 | 5 |
| August 2026 | **0** | 0 | 0 | 0 |
| September 2026 | **0** | 0 | 0 | 0 |

**The last job created by a real contractor was 30 July.** Every job in August and September
belonged to an internal account. This supersedes §14.2 and §10: the August figures did not describe
contractors choosing to type rather than speak, because no contractor was using the product at all.

### 16.2 — The abandonment signal is real, and it is one person

§14.1 withdrew the 41% mid-call abandonment rate as Jacob's own bad test runs. With the
classification applied, that correction was right about the contamination and wrong about the
residue: **10 of the stranded sessions belong to real contractors, not to internal accounts.**

| Contractor | Voice attempts | Abandoned | Completed |
|---|---|---|---|
| `b17a6f91` | 17 | **9** | 8 |
| `bf148ad2` | 3 | 1 | 2 |
| four others | 1 each | 0 | 1 each |

**One contractor accounts for nine of the ten.** They were the heaviest real user of the product —
20 jobs between 10 and 30 July — they tried voice seventeen times, more than half of those attempts
ended without a quote, and they have not returned since 30 July.

That is a 53% failure rate for the one person who used the product most, followed by their
departure. It is a single account and cannot carry a percentage; as an account of what happened it
is unambiguous.

### 16.3 — What this does to the invention rate

| Population | Quotes | Drafted | Final | Dropped |
|---|---|---|---|---|
| Internal (Jacob's) | 16 | 80 | 27 | 66.3% |
| Real contractors | 7 | 27 | 21 | **22.2%** |

The real-user figure rests on 27 line items across 7 quotes and cannot gate anything. Its value is
in what it rules out: the 55% was three-quarters internal testing.

### 16.4 — What follows

Every queued item — observability, the harness, the pricing fixes — is being built for a user base
that has not opened the product in five weeks, and whose heaviest member left after failing to
complete more than half their calls. That does not make the work wrong; the harness in particular
is more necessary, not less, because there is now no organic signal whatsoever. But it settles the
sequencing question: **VOICE-4 is not one priority among several. It is the only item that
addresses why the one real user stopped.**

It also retires a question. §10 recommended asking the nine contractors why they stopped; §14.2
withdrew that because Jacob had told them to. Both readings were wrong. Most of those accounts
made one job each and never returned, and the one that persisted abandoned half its calls. The
question worth asking is narrower and addressed to one person.

---

## 17. The invention rate was entirely family (3 Sep 2026)

Jacob identified `b17a6f91` "Aspire Plastering" as **his father's account**, and the nine
abandoned sessions on it as errors his father found and reported to him — not a contractor
giving up. Re-segmenting the 23 paired quotes:

| Population | Accounts | Quotes | Drafted | Final | Dropped |
|---|---|---|---|---|---|
| Jacob's own | 5 | 16 | 80 | 27 | 53 |
| His father (two signups) | 2 | 3 | 18 | 12 | 6 |
| Not tradespeople | 1 | 1 | 0 | 0 | 0 |
| **Arms-length contractors** | **3** | **3** | **9** | **9** | **0** |

**Every one of the 59 deleted line items came from Jacob or his father. Arms-length contractors
have deleted nothing, ever** — nine drafted lines, nine kept.

This is the end of the thread that began with the 55%. There is no user-derived invention signal,
there never was one, and no amount of re-segmenting will produce one from this data. The
arms-length population is three accounts with one quote each.

It also retires the reading in §16.2. That section treated nine abandoned sessions as a real user
failing and leaving; they were a family member finding bugs and reporting them, which is testing.
The correction is the same shape as §14 and §16: **a number describing user behaviour cannot be
read without knowing who the users were**, and this dataset has no arms-length users to describe.

### 17.1 — D10 is not open; D11 is answered but unrecorded

Addendum 1 §A10.3 lists D10 and D11 as still open from August. Checked:

- **D10 is decided**, on 28 Aug and recorded in `areas/motko.md`: invoicing before completion is
  permitted, with Final blocked until work is marked complete, Deposit and Materials allowed, and
  a warn-and-confirm rather than a hard block before the contract is signed. Nothing is waiting on
  it, and I1 is not blocked by it.
- **D11 was answered by implementation and never written down.** PRICE-4 (#452, 31 Aug) shipped the
  reconciliation gate as blocking: `src/app/jobs/actions.ts:1197` throws on a reconciliation
  failure at send. So the gate blocks in production today. What is missing is the decision record,
  not the behaviour.

That distinction matters now because of PFIX-1. Making the extractor refuse ambiguous amounts will
push more lines to unsourced, and unsourced lines fail this gate — so a change intended to stop
wrong prices reaching customers will, against a blocking gate, stop more quotes being sent at all.
Whether that is right is a real decision and it should be taken deliberately rather than inherited.
