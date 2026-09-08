# Factory Deployment Procedures

## How production is deployed

Vercel deploys `main` to production on merge. There is no gate in front of it,
and nothing in this repository promotes a deployment.

Two things that were once documented here as gates never existed:

- A `promote-to-production` job that would alias `motko.app` to a health-checked
  URL. Every URL it could see belonged to an **unmerged factory branch**, and
  both of its triggers resolved `heads/main` and asked for a Preview deployment
  on it, which does not exist. It never ran once. #462 has the trace.
- A post-deploy health check that would block promotion on a failed smoke test.
  It gated nothing (there was nothing to gate), and it was removed on 4 Sep 2026
  — see below.

If a gate in front of production is wanted, it needs whatever Vercel registers
for the production branch. That is a new capability, not a repair, and it gets
its own ticket.

## The health check, and why it is gone

`deploy-health-check.yml` smoke-tested each factory branch's **preview** against
three critical paths — the dashboard, a public quote page, and the TrueLayer
webhook — and commented on the issue and PR when they failed.

It was removed because it could not pass, and had not passed on any recorded
run:

- Its credentials were never set. `HEALTH_CHECK_TEST_EMAIL`,
  `HEALTH_CHECK_TEST_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` were all blank in every run, so the
  authenticated path stopped before making a request.
- **Vercel deployment protection answered 302** to the two paths that need no
  credentials at all, redirecting to its SSO login before the request reached
  the app. No secret fixes that.
- Even fully configured it would have proved little: the dashboard check
  accepted `301,302,303,307,308` alongside `2xx`, and a redirect to the login
  page is exactly what a *failed* sign-in returns. It would have passed whether
  or not authentication worked.

Meanwhile it commented *"the deployment will not be promoted to production"* on
every factory item, always — next to green gates and QA passes. A warning that
fires on everything trains everyone to scroll past the one that is real.

**If you want it back**, it needs three things, in this order: a Vercel
Protection Bypass for Automation secret sent as the `x-vercel-protection-bypass`
header (or the check pointed at production instead of previews), the four
repository secrets above actually set, and the dashboard path narrowed to accept
`200` only. Without all three it is noise. #567 records the reasoning.

**One loose end it leaves behind.** `src/lib/supabase/middleware.ts` accepts
`Authorization: Bearer <token>` in addition to cookie sessions, on all routes,
and it was added for the health check. Every token is validated through
`supabase.auth.getUser(token)`, so it is not an open door — an invalid or
expired token is rejected exactly as a bad cookie would be. But its only
consumer is gone, and unjustified auth surface should not survive by accident.
Removing it is an auth change and needs a decision, not a tidy-up.

## Schema changes and migrations

**Database migrations are applied by hand, and schema must precede code.**
`supabase db push` does not run on Vercel deploy. Apply a migration to
production **before** merging the code that reads or writes the new columns, or
the deploy breaks on a schema that isn't there.

A **removal inverts this**: the code must stop reading the column *before* the
column disappears. So a retirement merges first, deploys, and only then is the
migration pushed.

After any PR carrying migrations merges, confirm production is in sync — and
confirm the object itself exists or is gone, not merely that the ledger ticked.
A migration can be recorded as applied while its DDL never landed, which is what
`migration repair` leaves behind.

## Rollback

Nothing rolls back automatically, because nothing promotes automatically.

### Via the Vercel dashboard

1. https://vercel.com/jacobabuckland/motkoquote → Deployments
2. Find the last known-good deployment
3. Three-dot menu → "Promote to Production", and confirm

### Via the Vercel CLI

```bash
npm i -g vercel
vercel login
vercel ls motkoquote
vercel alias set <deployment-url> motko.app
```

### Via git

```bash
git revert <bad-commit-sha>
```

Prefer a revert commit. Force-pushing `main` is a last resort and rewrites
history other clones are built on.

**A rollback does not undo a migration.** If the bad deploy shipped alongside
schema changes, reverting the code leaves the schema where it is — work out what
the reverted code expects before promoting an older deployment over it.

## Where to look when something is wrong

- **GitHub Actions** — the CI gate and the factory workflows:
  https://github.com/jacobabuckland/motkoquote/actions
- **Vercel** — build logs, function logs, deployment and alias state:
  https://vercel.com/jacobabuckland/motkoquote
- **Supabase** — Postgres logs and the migration ledger
- **Sentry** — runtime errors from production

The factory's own failure reporting lives on the issue: a blocked item carries a
`DECISION NEEDED` comment naming the failing job and quoting the log.
