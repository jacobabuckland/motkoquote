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
