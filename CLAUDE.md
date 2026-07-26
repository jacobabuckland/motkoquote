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

# Migrations

- Supabase migrations are applied **manually** via `supabase db push` against the
  linked project. They do **not** run automatically on Vercel deploy. Therefore
  **schema must precede code**: apply a new migration to production BEFORE merging
  the code that reads/writes the new columns, or the deploy will break.
