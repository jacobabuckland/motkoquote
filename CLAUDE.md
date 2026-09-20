@AGENTS.md

# Canonical repository — read before making ANY change

- **Canonical repo:** `jacobabuckland/motkoquote`. **Canonical branch:** `main`.
- `main` is what production (Vercel → motko.app) deploys. There is exactly ONE
  source of truth: `origin/main`. Do not treat any other branch or local clone
  as authoritative.
- **Every session, before making changes, verify you are in the right place:**
  run `git remote -v` (must be `jacobabuckland/motkoquote`) AND `git branch`
  (know which branch you are on). If either is unexpected, stop and reconcile.
- **At the start of any audit or report, state which branch and commit you are
  reading** (e.g. "auditing `main` @ `c7ddfd7`"). A report is only meaningful
  against a known tree — the 2026-07-26 hunt was invalidated by auditing a stale
  branch. Never audit blind.
- **Feature work happens on short-lived branches, PR'd to `main` within the same
  working session wherever possible.** Nothing stays stranded on a long-lived
  divergent branch. Merge up, or park it in an issue — never leave it dangling.

# Invariants

- **Voice sessions must ask, not infer, required pricing slots.** During a voice
  quote intake the assistant must actively ask the customer for the three
  required scope slots — crew size, pricing mode (fixed vs day-rate), and who
  supplies materials — rather than silently guessing or defaulting them. The
  pricing-mode question is mandatory once scope is clear. Assumptions are only a
  last resort after an explicit deflection, and the wrap-up ask exists as a
  safety net, not a substitute for asking naturally in-call.

# Judging a factory branch

- **A typecheck failure may be masking worse. Fix it, then run the full suite
  before judging the branch's state.** Type errors fail the gate early, so
  nothing downstream runs and the branch looks one small fix from done. On #123
  the failing `.catch()` on a Supabase thenable hid eight acceptance tests
  failing against `computeReferralDuplicateCorrections not implemented` — the
  Engineer had left the core function a stub. A branch is only as finished as
  its full suite says, and the gate stops at the first error.

- **When an agent proposes disabling a check, the answer is almost always no.**
  Three instances in two days: #93 added `"tests"` to `tsconfig.exclude`, which
  silently removed every test file in the repo from typecheck; #119 raised the
  compile target repo-wide to satisfy seven regex flags that turned out to be
  inert; #119 again asked to exclude `tests/acceptance/**` from ESLint, on a
  test that was already lint-clean. Each was argued fluently and each would have
  removed the check that catches the class of defect it was reacting to. Read
  the premise before the argument — twice the premise was false.

- **Agent reasoning and agent conclusions fail independently.** QA has been
  right for the wrong reason and wrong on an accurate observation, in the same
  dispute (#119). Weigh a verdict on the evidence it cites, not on its
  confidence, and prefer a bound test over an opinion wherever one can be
  written.

# UI conventions

- **Every completing action navigates deliberately — never rest on a spent
  form.** Once a user finishes an action, the form they used is spent; leaving
  them staring at it (or bouncing them back to it) is a bug. The destination is
  determined by what the action was, per the map below. Buttons follow the
  settled end-state pattern first — the label lands on its terminal "Sent ✓"
  (never resting on a "Sending…" spinner) *before* the navigation fires, so a
  slow or wedged `router.push`/`refresh` can never strand the control mid-spin.

  | Action kind | Examples | Destination |
  |---|---|---|
  | Job-scoped completion | send quote, send contract, create/send invoice, mark as paid, accept-adjacent | the job page `/jobs/[id]`, with `?sent=…` (and `delivered=0` / `payout=setup` when the send reached no channel or setup is outstanding) so the banner confirms what happened and carries any copy-link fallback |
  | Job-ending | archive quote | stay on the dashboard (already there); the row leaves the pipeline and a toast confirms |
  | Non-job save | settings / setup section saves | stay in place, "Saved" toast — no navigation |
  | Setup completion | finishing onboarding | dashboard |

- A send that reached **no** channel still marks the record sent server-side —
  it is a spent form all the same, so it navigates too (to the `delivered=0`
  banner variant), rather than lingering on the form to show a copy-link. The
  job page is the single source of truth for "what happened"; the copy-link
  fallback lives in its banner, not on the form.

# Migrations

- Supabase migrations are applied **manually** via `supabase db push` against the
  linked project. They do **not** run automatically on Vercel deploy. Therefore
  **schema must precede code**: apply a new migration to production BEFORE merging
  the code that reads/writes the new columns, or the deploy will break.
- After any PR carrying migrations merges, **verify `supabase migration list` shows
  prod in sync before closing the session.** The ledger alone is not proof: a
  migration can be recorded as applied while its DDL never landed (a ghost apply
  from `migration repair`). When it matters, confirm the actual column/table
  exists on prod (e.g. probe the REST API), not just that the version is ticked.

# Voice harness hone-in

You are closing a **single Motko voice behaviour** until GPT’s retest marks it
clean. Iterative hone-in, not a backlog sweep. Loop diagram: `harness/LOOP.md`.
File map: `harness/WHERE_THESE_LIVE.md`. GPT’s standing orders:
`harness/GPT_HARNESS.md`. GPT must end every scored run with
`npm run harness:run-and-write -- /path/to/scored.json` (always calls
`write-result.ts`) — do not paste a device-local result over these files by
hand when the writer can do it.

## Priority order

1. If `harness/NEXT_FIX.md` has `status: open` → implement the fix for that
   `caseId` only. Open a PR. On merge: set `status: honing`, fill `fixPr`, and
   rewrite `harness/RETEST_PROMPT.md` so GPT retests **exactly** that behaviour
   (verbatim script + pass/fail checks). Stop.
2. If `status: honing` → do not start a new case. Wait for a new harness result
   for this `caseId` (or read the latest single-case JSON).
   - Failed again → tighten the same fix (read new transcript; don’t broaden).
     Bump `attempts`. Refresh `RETEST_PROMPT.md` if the failure mode changed.
   - Passed → set NEXT_FIX to idle (empty template), set RETEST `status: clean`,
     archive result JSON, briefly note what is now clean. Only then may you pick
     a new finding.
3. If `status: idle` and there are new multi-case results under
   `harness/results/` → pick **one** highest-severity failure, fill NEXT_FIX,
   leave other failures listed only in `harness/BACKLOG.md`. Do not multi-fix.
4. Else stop and say there is no harness work.

## How to work a locked case

- Trust `turns` in the JSON over harness `diagnosis`.
- Smallest change that makes the RETEST pass checks true.
- Motko only prices from the trader’s rates; never invent market rates; never
  auto-send.
- User-facing copy: en-GB.
- PR title/body: `Hone <caseId> (attempt N)` and link `runId`.

## After every merge that claims a fix

Your job is incomplete until GPT has a clear `RETEST_PROMPT.md`. Write that
prompt yourself from the acceptance checks — specific script, specific
pass/fail, out of scope listed. That is how GPT and you speak to each other.

## Do not

- Do not run or ask for the full suite while honing.
- Do not clear NEXT_FIX on merge — only on clean retest.
- Do not stack a second case into NEXT_FIX.
- Do not delete history; archive under `harness/results/archive/`.

## Context you must load (do not rely on chat memory)

Before any harness fix, read in order:

1. `harness/NEXT_FIX.md`
2. The linked `resultFile` (and prior archived JSON for the same `caseId` if
   present)
3. `harness/RETEST_PROMPT.md` if status is `honing`
4. `harness/LESSONS.md`
5. The Motko code paths that implement quoting / voice / line-items for this
   trade

When a case becomes clean, append one bullet to `harness/LESSONS.md` so the
next LLM session inherits it.
