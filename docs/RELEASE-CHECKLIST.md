# Release checklist (Workflow A)

Run before **any** tester-facing deploy. Any failure blocks the release. This
is the repo artefact the `release-qa` skill references — the skill holds the
theory; this holds the runnable steps for Motko.

Environment: QA runs against **production (motko.app) on the seeded demo/test
account only** — never a real tester's account. Emails/SMS to the owner's own
contacts only. Exercise settlement with **mark-as-paid**, never a real TrueLayer
payment.

## Steps

- [ ] **1. Mechanical gate.** `npm run check` (invariant checker + type-check +
      tests) green, and `npm run build` clean. Lint (`npm run lint`) reviewed —
      no new errors vs `main`.
- [ ] **2. Zero console errors** on core pages: `/dashboard`, `/settings`, a
      `/jobs/[id]` detail, and the landing page. Hydration/runtime errors, once
      fixed, stay fixed.
- [ ] **3. Playwright smoke** against the seeded demo account (see
      "Demo-account storageState" below to unblock this).
- [ ] **4. Agent click-through** (Workflow B) using `docs/qa-chrome-prompt.md`
      on the test account. All **Broken** findings fixed and re-verified before
      release; Confusing/Polish may ship with a logged decision.
- [ ] **5. Real-device pass** (phone width): sign-in persistence; one full core
      loop via the canonical **Fenland voice-quote script**; money-critical
      flows (send, mark-paid, customer-facing `/q/[id]` and `/i/[id]`).
- [ ] **6. Founder eyeball** (10 min, non-delegable): first-screen impression;
      one customer-facing money document read fully; one full send flow.
- [ ] **7. Merge hygiene.** No finished work stranded on unmerged branches; a
      tester-facing line added to `docs/CHANGELOG.md`.

## Demo-account storageState (unblocks step 3 for every future run)

The Playwright smoke suite needs an authenticated session for the seeded demo
account. Generate and store it **once**, then re-use (regenerate when it expires):

1. Run the helper — it opens a browser for you to sign in **by hand** (no
   credential ever touches the repo or an agent):
   ```
   node scripts/qa-save-auth.mjs
   ```
2. Sign in as the **seeded demo account** in the window that opens, land on
   `/dashboard`, then return to the terminal and press Enter.
3. The session is written to `e2e/.auth/demo.json` (git-ignored — never commit
   it). Point the smoke suite's `storageState` at that file.

When the smoke suite exists, wire it into step 1's gate. Until then, step 3 is
covered by the Workflow B click-through (step 4).

## Known gaps (bootstrap — 2026-07-26)

- CLAUDE.md has **no Invariants section** yet. `scripts/check-invariants.mjs`
  currently enforces two hard invariants (single money formatter, single
  settlement writer) and warns on ad-hoc currency formatting. A Workflow D sweep
  should write the invariants into CLAUDE.md and tighten the checker's warnings
  into failures.
- No Playwright smoke suite yet — only the storageState recipe above.
- Two pre-existing lint errors outside recent work: `setup-form.tsx:357`,
  `jobs/[id]/page.tsx:175` (React "during render" rules).
- Several long-lived unmerged branches need a merge/discard audit (Workflow D).
