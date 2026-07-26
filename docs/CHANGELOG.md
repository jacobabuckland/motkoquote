# Changelog

Tester-facing notes, newest first. One line per release-worthy change; keep it
plain enough for a non-technical tester to understand what to re-check.

## 2026-07-26

- **Reliability & data-integrity hardening** (bug-hunt 2026-07-27 remediation,
  PR #61): payments now settle exactly once (no double fee charges), payment
  reminders send exactly once, issued quotes/invoices/contracts are retained
  (never destroyed) when an account is deleted, SMS STOP is honoured reliably,
  and the dashboard/reminders run faster. No changes to how jobs are priced.
- **QA tooling bootstrapped**: `npm run check` invariant gate, release checklist,
  and click-through prompt added so releases are verified the same way each time.
