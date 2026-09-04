# Pipeline map — Pass A recon

**Read against:** branch `claude/new-session-p832ph`, identical to `origin/main` @ `f4947aa`
(*VOICE-3: A call that ends without customer name or contact must be visible (#511)*), 2 Sep 2026.
The local `origin/main` ref was 50 commits stale on checkout; it was fetched and the branch
confirmed 0 ahead / 0 behind before anything below was read.

**Scope:** Pass A of `motkorobustnessbrief.md` — recon only. No verdicts, no recommendations,
no tickets, nothing implemented. Claims in the brief's §2–§3 are neither confirmed nor
contradicted here; §7 below records observations Pass B will need, without judging them.

---

## 1. Voice → quote path, end to end

The authenticated path runs in the browser until the call wraps, then in one server action.

| # | Stage | File | Exported symbol | Notes |
|---|---|---|---|---|
| 1 | Session mint | `src/app/jobs/actions.ts:83` | `createRealtimeSession` | Inserts the `jobs` row, builds intake instructions + tools, returns an OpenAI client secret. Deliberately performs **no** knowledge retrieval (long comment at `:97-110` explains the removal). |
| 1a | Client-secret exchange | `src/lib/realtime.ts:26` | `createRealtimeClientSecret` | `POST /v1/realtime/client_secrets`. Pins model, tools, transcription model, `semantic_vad` turn detection, voice `marin`. |
| 2 | Audio capture | `src/components/voice/job-intake.tsx:970,992` | `JobIntake` (default) | `navigator.mediaDevices.getUserMedia` → `RTCPeerConnection` → WebRTC to OpenAI Realtime. Browser/WKWebView only; no server-side audio. |
| 3 | Transcription | (OpenAI, server-side) | — | `TRANSCRIPTION_MODEL` = `gpt-4o-mini-transcribe`, `TRANSCRIPTION_LANGUAGE` = `en`, both `src/lib/models.ts:74,89`. Arrives as Realtime data-channel events. |
| 4 | Transcript accumulation | `src/components/voice/job-intake.tsx:1084-1099` | — | Two event types are kept: `conversation.item.input_audio_transcription.completed` → contractor, `response.output_audio_transcript.done` → assistant. Written to **two parallel refs**: `transcriptRef` (flat `string[]`) and `conversationTurnsRef` (`TranscriptTurn[]`). |
| 4a | Turn labelling | `src/lib/voice-transcript.ts:40,54,66` | `speakerForTranscriptEvent`, `appendTranscriptTurn`, `flatTranscript` | Pure, unit-testable. `TranscriptTurn = { speaker: "contractor" \| "assistant", text, at }`, zod-validated (`transcriptTurnSchema`). |
| 5 | Conversation handling | `src/app/jobs/actions.ts:303` | `saveSowDelta` | Realtime tool-call sink; merges partial SoW state into `jobs.sow_json` mid-call. Tool defs at `src/lib/voice/job-intake-prompt.ts:31,66` (`BASE_REALTIME_TOOLS`, `ACCOUNT_REALTIME_TOOLS`). |
| 6 | Wrap → post-call pipeline | `src/app/jobs/actions.ts:355` | `completeSowConversation` | Single server action; everything from 7 to 14 happens inside it. Timed as `pipeline_ms`. |
| 7 | Stated-price extraction | `src/lib/voice/stated-prices.ts:411,434` | `extractStatedPrices`, `getChargeableStatedPrices` | Deterministic (regex/rule-based, 447 lines), run on the flat transcript at `actions.ts:408`. Output stored on `sow_json.stated_prices`. |
| 8 | Extraction | `src/lib/schemas/sow.ts:901` | `sowToExtraction` | Pure `SowState → JobExtraction`. Called twice — once pre-narrative for retrieval keys, once after (`actions.ts:419,452`). |
| 9 | Context lookups | `src/lib/knowledge.ts`, `src/lib/pricing-history.ts`, `src/lib/quote-learning.ts` | `findSimilarPastJobs`, `findKnownMaterialPrices`, `getContractorTendencies` | Run in one `Promise.all` with `team_members` + `rate_cards` reads and the narrative call (`actions.ts:424-446`). |
| 10 | SoW narrative | `src/lib/claude.ts:26` | `generateSowNarrative` | Anthropic call, prose only, 512 tokens. |
| 11 | Trace persistence | `src/app/jobs/actions.ts:453-467` | — | One `jobs` update writing `sow_json`, `extracted_json`, `transcript`, `conversation_json` (only when turns were supplied), `status: "extracted"`. |
| 12 | Drafting (LLM) | `src/lib/claude.ts:83` | `draftQuoteLineItems` | Anthropic, `DRAFTING_MODEL` = `claude-sonnet-4-6`, temp `1.0`, 4096 tokens. Emits **structure only** — four line kinds (`labour`/`material`/`rate_card`/`provisional`); output parsed by `quoteDraftSchema`. Takes `statedPrices` as a third argument. |
| 13 | Deterministic pricing | `src/lib/compile-draft.ts:546` | `compileDraftToLineItems` | Computes every amount in code from contractor rates / rate cards / known material prices / markup. Returns `{ lineItems, mismatches, contractorFlags }`; each mismatch is emitted as a `pricing_mismatch` event. |
| 13a | Agreed-cost overrides | `src/lib/agreed-costs.ts` | `applyAgreedDayRate`, `applyAgreedFixedPrice` | Day rate first, then fixed price. |
| 13b | Pricing mode | `src/lib/pricing-mode.ts` | `applyPricingMode`, `resolvePricingMode` | `fixed` collapses to one works line; `days`/`calculated` keep the breakdown. |
| 13c | Totals | `src/lib/quote-math.ts:48` | `computeQuoteTotals` | |
| 13d | Fidelity guards | `src/lib/stated-price-guard.ts:59,200`, `src/lib/customer-details-guard.ts` | `reconcileStatedPrice`, `withStatedPriceFlag`, `withCustomerDetailsFlag` | Produce contractor-only flags, not customer copy. |
| 14 | Line-item persistence | `src/app/jobs/actions.ts:558-572` | — | One `quotes` insert: `line_items_json` (active view), `drafted_line_items_json` (full calculated baseline), `contractor_flags_json`, `total`, `status: "draft"`. Job → `status: "drafted"`. |
| 15 | Learning sync | `src/lib/quote-learning.ts` | `syncQuoteKnowledge` | Embeds the calculated breakdown into `knowledge_chunks`. |
| 16 | Editor / user edits | `src/app/jobs/actions.ts:962` | `updateQuoteLineItems` | Mutates `line_items_json`; `drafted_line_items_json` is the immutable baseline. |
| 17 | Send | `src/app/jobs/actions.ts:1062` | `sendQuote` | Guards in `src/lib/quote-send-guards.ts`. |
| 18 | Quote render (web) | `src/app/q/[id]/page.tsx`, `quote-response.tsx` | — | Public customer view. |
| 18a | Quote render (PDF) | `src/lib/pdf/quote-pdf.tsx`, `render-quote.ts`, `quote-payload.ts` | `buildQuoteScope` | `@react-pdf/renderer`; served by `src/app/api/quotes/[id]/pdf/route.ts`. |
| 18b | SoW render | `src/app/jobs/[id]/sow/page.tsx`, `src/lib/pdf/sow-pdf.tsx` | — | PDF via `src/app/api/jobs/[id]/sow-pdf/route.ts`. |
| 18c | Contract render | `src/lib/contracts/{templates,render-template,build-variables,markdown}.ts`, `src/lib/pdf/contract-pdf.tsx` | — | PDF via `src/app/api/contracts/[id]/pdf/route.ts`. |

**Recovery / side paths off the same spine**

| Path | File | Symbol | Notes |
|---|---|---|---|
| Re-draft after a failed pipeline | `src/app/jobs/actions.ts:636` | `redraftJob` | Re-runs 12→14 from the persisted SoW. Does not reopen the call. |
| Save transcript and leave | `src/app/jobs/actions.ts:909` | `saveVoiceTranscript` | Second (and only other) writer of `conversation_json`, line 931. |
| Pipeline failure report | `src/app/jobs/actions.ts:948` | `reportVoicePipelineFailure` | Emits `voice_pipeline_stage_failed`. |
| Empty-draft report | `src/app/jobs/actions.ts:891` | `reportEmptyQuoteDraft` | Emits `quote_draft_empty`. |
| Guest (unauthenticated) quote | `src/app/start/actions.ts:23` → `src/lib/guest/quote.ts:73` | `draftGuestQuoteAction` → `draftGuestQuote` | Runs stages 8→13c with **no Supabase import anywhere in its module graph**; returns the quote to the caller. |
| Cost intake | `src/components/voice/cost-intake.tsx`, `src/lib/voice/draft-cost.ts`, `src/app/costs/actions.ts` | — | Separate voice surface (job costs), not the quote path. |
| Ledger query | `src/app/api/ledger/query-session/route.ts`, `src/lib/voice/ledger-query-prompt.ts` | — | Third voice surface, read-only queries. |

---

## 2. Prompts

All prompts are **TypeScript string literals in the tree**. There are no template files, no
database-held prompts, no runtime fetch, and **no version field or prompt-id anywhere** —
the deployed commit is the only version identifier.

| Prompt | File | Assembly |
|---|---|---|
| Job intake (voice, system instructions) | `src/lib/voice/job-intake-prompt.ts:290` — `buildJobIntakeInstructions` | Assembled at runtime from a `JobIntakePersonalisation` object (trade, first name, crew, day rate, first-run flags). 369 lines. `MAX_SOW_TURNS = 5`. |
| Job intake (tools) | same file `:31`, `:66` — `BASE_REALTIME_TOOLS`, `ACCOUNT_REALTIME_TOOLS` | Static consts; guest gets the base set only. |
| SoW narrative | `src/lib/claude.ts:33-46` | Fixed inline literal, no interpolation. |
| Quote drafting | `src/lib/claude.ts:92-179` | Assembled at runtime by string concatenation into `systemPrompt`, in three parts: a fixed opener; a **conditional locked-price block** inserted only when `getChargeableStatedPrices()` is non-empty, listing each stated amount and its qualifiers; then a fixed constraints/format block. Job data + contractor context go in the user message as JSON. |
| Cost intake | `src/lib/voice/cost-intake-prompt.ts` | Same shape as job intake. |
| Ledger query | `src/lib/voice/ledger-query-prompt.ts` | Same shape. |

Models are centralised in `src/lib/models.ts`: `DRAFTING_MODEL` `claude-sonnet-4-6` @ temp `1.0`,
`VOICE_MODEL` `gpt-realtime-mini-2025-12-15`, `TRANSCRIPTION_MODEL` `gpt-4o-mini-transcribe`.

---

## 3. Test position

**Runner:** vitest 4.1.10, `npm test` → `vitest run`. Config `vitest.config.ts`: `environment: "node"`
by default, `@` → `./src`, setup `tests/setup.ts`. DOM is opt-in per file via
`@vitest-environment happy-dom` (`@testing-library/react` + `happy-dom` installed).
A second config, `vitest.live.config.ts`, runs the checks the default config excludes.

**Measured on this tree** (`npm ci && npm test`, this session):

```
Test Files  291 passed (291)
     Tests  3809 passed (3809)
  Duration  124.79s
```

**Layout**

| Location | Test files | Content |
|---|---|---|
| `tests/acceptance/` | 91 | Frozen per-issue contracts written by the PM agent. |
| `tests/regression/` | 137 | Defect-anchored tests. |
| `tests/unit/` | 5 | |
| `tests/integration/` | 3 | Excluded from the default suite (real DB, service-role key); run by `vitest.live.config.ts`. |
| `tests/examples/` | 2 | Documented patterns (component render, DOM + Capacitor). |
| `src/**/*.test.ts(x)` | 59 | Colocated unit tests. |
| `src/checks/*.check.test.ts` | 3 | Live production assertions (`rls`, `function-privileges`, `object-inventory`), excluded by name from the default suite, run on schedule by `rls-check.yml`. |
| `tests/helpers/capacitor.ts` | — | Shared Capacitor plugin mocks (mandated by `AGENTS.md`). |

**Fixtures.** Two files, one job, no directory of transcripts:

- `fixtures/fenland-bathroom.md` — prose record of a real end-to-end bathroom-refit intake
  (**contains customer name, address and phone in plain text**).
- `src/lib/fixtures/fenland-bathroom.ts` — the structured form the tests consume.

There is no `fixtures/transcripts/`, no expected-output files, no snapshot/golden-file
directory for rendered documents, and no `test:pipeline` script.

**Tests that touch the quote pipeline** (importing `compile-draft`, `draftQuoteLineItems`,
`extractStatedPrices`, `completeSowConversation`, `sowToExtraction` or `stated-price-guard`) — 21 files:

`src/lib/compile-draft.test.ts` · `src/lib/note-channels.test.ts` · `src/lib/schemas/sow.test.ts` ·
`src/app/jobs/send-quote.test.ts` · `src/app/jobs/update-quote-line-items.test.ts` ·
`tests/acceptance/{141,418,424,443,451,481}.test.*` · `tests/acceptance/quote-edit-status-guard.test.ts` ·
`tests/regression/{first-run-no-invented-prices, guest-draft-quote, intake-prompt-no-retrieval,
send-quote-guards, stated-price-reconciliation, unpriced-line-document, unresolved-rate-editor,
unresolved-rate-flag, factory-pm-files-callsites}.test.*`

They exercise the pricing/compile layer and its guards. None replays a transcript end to end,
and none snapshots a rendered quote, SoW or contract.

---

## 4. CI jobs

Sixteen workflows. Only `ci.yml` gates code; the rest drive the factory or run on a schedule.

### `ci.yml` — trigger: `pull_request` (opened/synchronize/reopened/ready_for_review) + `push` to `main`

| Job | Applies to | Gates |
|---|---|---|
| `gate` | all | `npm run typecheck` → `npm run lint` → `npm test` → `node scripts/check-generated-language.mjs` → `npm run build`. Timeout 20m. **This is the deterministic Verifier.** |
| `acceptance-test-immutability` | PRs from `factory/*` only | Acceptance tests may be written once, by the PM agent. |
| `spec-immutability` | PRs from `factory/*` only | `docs/specs/N.md` may be written once, by the PM agent. |
| `cross-branch-collisions` | all PRs | `scripts/ci/cross-branch-collisions.ts` — compares against every other open factory branch. |
| `secret-scan` | all PRs | Scans the diff for credentials. |
| `migration-check` | all PRs | Migrations must be additive and reversible. |
| `schema-in-tree` | all PRs | `scripts/ci/check-schema-in-tree.ts` — every column a `select` names must exist in a migration. |
| `schema-drift-probe` | all PRs | Tree vs. production schema. |

### Other workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `factory-pm.yml` | `issues` label + dispatch | PM agent — derives the spec and freezes acceptance tests. |
| `factory-engineer.yml` | `issues` label + dispatch | Engineer agent — implements on `factory/N`. |
| `factory-qa.yml` | `issues` label + dispatch | QA agent — second-opinion review. |
| `factory-deploy.yml` | `issues` | Vercel preview. |
| `factory-ship.yml` | `pull_request: closed` | On merge of a `factory/*` PR into `main`: closes the issue, marks shipped. Merging is the human confirmation. |
| `factory-reconciler.yml` | cron `*/15 * * * *` | |
| `factory-supervisor.yml` | cron `43 * * * *` | |
| `factory-poll-notion.yml` | cron `17 * * * *` | Pulls roadmap items from Notion. |
| `factory-decisions-digest.yml` | cron `0 7 * * *` | Triage digest. |
| `factory-decay-sweep.yml` | `push` + dispatch | Frozen-contract decay sweep. |
| `factory-block-ledger.yml`, `factory-answer-resume.yml`, `factory-notion-status.yml` | `issues` / `issue_comment` | Block bookkeeping, resume-on-ANSWER, Notion write-back. |
| `rls-check.yml` | cron `30 6 * * *` + dispatch | Runs the three `src/checks/*.check.test.ts` live against production with a service-role key. |

**Required for merge:** branch-protection settings are not in the tree, so the required-check
list cannot be established from here — it needs the GitHub settings API. What *is* in the tree:
`factory-engineer.yml` and `factory-qa.yml` both contain a "refuse to proceed on a red CI gate"
step that polls the `gate` job's conclusion for the branch head, so `gate` is enforced as a
hard precondition inside the factory regardless of branch protection.

---

## 5. The factory's Verifier

Verification is split in two, and the split is explicit in the QA prompt.

**Deterministic half — `ci.yml → gate`.** What it can assert today: TypeScript compiles;
ESLint passes (including `no-explicit-any` and `no-assign-module-variable` as errors, over
`tests/` as well as `src/`); 3,809 vitest assertions pass; `check-generated-language.mjs`
passes; `next build` succeeds. Plus, per-PR: no secrets in the diff, migrations additive and
reversible, no selected column absent from a migration, no schema drift, no cross-branch
collision, and (on factory branches) specs and acceptance tests unmodified.

**Judgement half — `factory-qa.yml`.** `anthropics/claude-code-action@v1`, `--model
claude-sonnet-4-5`, prompted (`:417-512`) explicitly as *"a SECOND OPINION, not the safety
mechanism. Deterministic CI already covers tests, types, lint and build."* It reviews
`git diff origin/main...HEAD` against `docs/specs/N.md` for spec fidelity, out-of-scope files,
secrets, migration safety, RLS, swallowed errors, dead code, PII in logs and added friction.
It writes `PASS` or `CHANGES` plus `FINDING: <key> — …` lines to `/tmp/qa-verdict.txt`.
Guarded by an iteration cap (`:135`), a refusal to review an empty branch (`:284`), and a
refusal to review over a red gate (`:324`, with the comment recording that on #97 three
reviews ran over a gate red since the first commit).

**What neither half can assert:** anything about content fidelity of a *generated* quote —
no test in the suite feeds a transcript through stages 7→14 and checks the resulting figures,
and no golden file covers the rendered quote, SoW or contract text. The judgement half reads
diffs, not outputs.

---

## 6. iOS shell boundary

`capacitor.config.ts` — Capacitor 7, `appId: app.motko.ios`.

- **Webview, not bundle.** The app is one server-rendered Next.js origin (RSC + Server Actions +
  Supabase SSR cookies) and cannot be statically exported, so iOS is a thin WKWebView pointed at
  `server.url` — `https://motko.app`, overridable for LAN dev via `CAP_SERVER_URL`.
- **`webDir: native/www`** holds two files only — `index.html` and `offline.html` — a branded
  pre-load splash. No application code ships in the binary.
- **`appendUserAgent: "MotkoApp"`** is how the server distinguishes app from browser
  (used to skip the marketing landing page). Read in `src/lib/platform.ts` / `src/lib/app-home.ts`.
- **Native surface:** APNs push (`@capacitor/push-notifications`, with
  `src/lib/push/*`, `src/app/api/push/{subscribe,test}`), haptics, share sheet, splash screen,
  status bar, keyboard, camera, dialog, preferences.
- **Voice runs in the webview.** `getUserMedia` + `RTCPeerConnection` are standard web APIs;
  `limitsNavigationsToAppBoundDomains: false` is set specifically to keep media capture
  available, with the native prompt gated by `NSMicrophoneUsageDescription`.
  `src/components/voice/mic-permission-screen.tsx` handles the permission surface.
- **Native project:** `ios/App/App.xcodeproj` + `.xcworkspace`; CI helper scripts in `ci_scripts/`.
- **Consequence for the pipeline:** every stage in §1 is either browser JS or server TypeScript.
  Nothing in the voice-to-quote path is native code, so the whole path is reachable from a
  Node test process without a device.

---

## 7. Observations Pass B will need

Recorded as facts about this tree, not verdicts. Pass B decides what they mean.

1. **`source_audio_url` has no writer.** The column is declared in
   `supabase/migrations/00000000000001_init_schema.sql:70` and nulled by
   `src/lib/account-erasure.ts:230`. Repo-wide, there is no other reference — no upload,
   no assignment, no storage bucket write. (B4)
2. **`conversation_json` has exactly two writers, both the same shape.**
   `src/app/jobs/actions.ts:463` (`completeSowConversation`) and `:931` (`saveVoiceTranscript`),
   both writing `TranscriptTurn[]` = `{ speaker, text, at }` per
   `src/lib/voice-transcript.ts:20`. Both are conditional — `...(conversationTurns ? { … } : {})`
   — so a call without turns leaves the column untouched rather than empty. No `{role, text}`
   writer exists in this tree. (B5)
3. **`client_errors` and `feedback` appear in neither `src/` nor `supabase/migrations/`.**
   Zero references. The 26 tables the code does read/write are listed by
   `grep -rho '\.from("[a-z_]*"' src`; neither is among them, and neither is created by any of
   the 57 migrations. `src/lib/analytics.ts:40,90` (`track`, `logError`) writes to `events`,
   never to `client_errors`. (B6)
4. **`material_prices` is not the table the code uses** — the code reads
   `contractor_material_prices` (`findKnownMaterialPrices`). `rate_cards` *is* read, in two places
   (`completeSowConversation`, `compileDraftToLineItems`), and `src/lib/rate-card-matching.ts:21`
   `findMatchingRateCard` matches against it. (B1)
5. **A stated-price path exists and is wired end to end.** `src/lib/schemas/stated-price.ts`
   declares `{ amount, item, transcript_span, qualifiers: { each, fitted, already_paid, excluded },
   superseded_by }`; `extractStatedPrices` populates it from the transcript before drafting;
   it reaches the drafting prompt as an explicit locked-price block and reaches
   `compileDraftToLineItems` as a fourth argument. (B1, and §6-R1 of the brief)
6. **A line-item provenance schema exists** — `lineItemProvenanceSchema` /
   `LineItemProvenance` at `src/lib/schemas/job.ts:57-64`, referenced from `lineItemSchema`. (B2, R3)
7. **The LLM is prompted never to set an amount.** `src/lib/claude.ts:94-96` — *"You NEVER set
   prices or totals — the app computes every amount in code … Any price you were to invent would
   be discarded."* `compileDraftToLineItems` is the only thing that assigns money. (B1)
8. **`drafted_line_items_json` is the *calculated* breakdown, not the raw model output.**
   `src/app/jobs/actions.ts:566` stores `calculatedLineItems` — post-compile,
   post-agreed-cost-override, pre-pricing-mode — while `line_items_json` stores the active view,
   which `applyPricingMode` may have collapsed to a single works line in `fixed` mode. The two
   therefore differ for reasons other than user deletion. (B3 — directly bears on whether the
   55% figure is a pure user-rejection signal)
9. **`stepper_inconsistency` is emitted from one place:** `src/app/jobs/[id]/page.tsx:278`. (B7)
10. **Thirteen event names are emitted repo-wide:** `error`, `gate_failure`, `pricing_mismatch`,
    `quote_created`, `quote_draft_empty`, `quote_sent`, `quote_viewed`, `signed_up`,
    `stepper_inconsistency`, `team_member_recorded`, `voice_pipeline_stage_failed`,
    `voice_saved_for_later`, `voice_session_completed`. There is **no** `voice_session_started`
    or `voice_session_abandoned`, and `voice_session_completed` is emitted only when the caller
    supplied a `wrapReason` (`actions.ts:600`, emitting at `:605`), i.e. only for a live call. `track()` swallows
    every failure by design (`analytics.ts:70-88`), counting them to the server console. (B4, O4)
11. **The pipeline is already close to invocable as a pure function.**
    `src/lib/guest/quote.ts:73` `draftGuestQuote` runs `sowToExtraction` → `generateSowNarrative`
    → `draftQuoteLineItems` → `compileDraftToLineItems` → agreed-costs → pricing-mode →
    `computeQuoteTotals` with no Supabase import in its module graph — the module comment states
    this is a property of the graph, not a promise. What it does *not* cover: `extractStatedPrices`
    (guest has none), the DB-backed lookups of stage 9, and document rendering. (B8 — bears
    directly on the Stage 1 estimate)
12. **`fixtures/fenland-bathroom.md` carries unredacted customer name, address and phone.**
    Relevant to F1's "no PII in fixtures" AC before any new fixture is added beside it. (F1)
13. **No prompt carries a version identifier.** Pinning a fixture's expected output to a prompt
    revision would need one added. (F2)

---

*Pass A ends here. Nothing above is a recommendation, and no claim from §2–§3 of the brief has
been adjudicated — that is Pass B, which should be run as a separate invocation using this map.*
