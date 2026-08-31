# Factory Supervisor

Hourly, change-driven factory status. It snapshots the factory's state, diffs it
against the previous snapshot, and writes a digest to a Notion page **only when
something changed**. On a quiet hour it writes nothing anywhere except a
snapshot commit.

The checks that shaped it — which invocation pattern, which secrets, where halts
actually live — are recorded in [`S0-checks.md`](./S0-checks.md), against
`main` @ `7e2157e`.

---

## Configure it before the first run

Two repository **variables** (Settings → Secrets and variables → Actions →
Variables). Neither is a secret; both are page ids.

| Variable | Needed when |
|---|---|
| `SUPERVISOR_PAGE_ID` | You already have a "Factory Supervisor" page. Preferred. |
| `SUPERVISOR_PARENT_PAGE_ID` | You do not, and want the supervisor to create one under this parent. |

The page is resolved in this order, and the last step is a loud failure rather
than a guess — a page created in the wrong place is not something a later run
can tidy up:

1. `SUPERVISOR_PAGE_ID`
2. the id recorded in the previous snapshot
3. a Notion search for a page titled `Factory Supervisor` shared with the
   integration
4. create one under `SUPERVISOR_PARENT_PAGE_ID`
5. `CAPABILITY FAULT`, naming both variables

Whichever page it lands on must have these four top-level headings, in order.
The supervisor replaces sections between them and refuses to touch a page whose
shape it does not recognise:

```
# Latest — <timestamp>
# Metrics
# Retro
# Run log
```

Every other credential is already in the repository: `NOTION_API_KEY`,
`NOTION_DATABASE_ID`, `FACTORY_TOKEN`, `ANTHROPIC_API_KEY`.

Once it has run once, record the page id here so `§11`'s question has an answer:

**Factory Supervisor page ID:** `____________`

---

## What it does each hour

```
snapshot → diff → [gate] → actions → digest (model) → publish → commit snapshot
```

- **The gate is a workflow condition, not a request to the model.** The digest
  step's `if:` reads the event count the diff printed. A model invoked with an
  empty diff writes a summary anyway, and it will be fluent — so it is never
  invoked with one.
- **The snapshot is committed last**, after publishing succeeds. If any step
  fails the baseline does not advance, and the next run re-detects the change.
  Advancing it first would lose a change permanently: detected, un-reported,
  and then invisible.
- **Two runs in the same hour produce one digest.** The previous snapshot's
  `taken_at` is the idempotency key.
- **A Notion rate limit skips the run** rather than taking a partial snapshot.
  A partial snapshot diffs as mass change.

State lives on the `factory-state` branch, which is created as an **orphan** on
the first run — it shares no history with `main`, so nothing on it can be
mistaken for a code change or reach a deploy. **Never merge it into `main`.**

## What it may write to

Four actions, and nothing else:

| Action | Constraint |
|---|---|
| Retry a failed preview deploy | Once per ticket per 24h |
| Requeue a stalled ticket | `In factory` 4h+ with no commits; **never** on any stopped label |
| Flag a duplicate | Flags only — it never closes anything |
| File a `[supervisor]` bug | One per distinct cause |

Every action appears in the digest with a one-line reversal instruction.

**It never resolves a halt.** Not by requeueing, not by restatusing, not by
closing. Reporting halts is the job; deciding them is not.

## Weekly

On the first run each Monday it also builds the outcome dataset, computes the
metrics, and runs the retro. A finding needs **three cited outcome ids** or it
is discarded, and each is filed as a `Needs spec` Roadmap ticket with its
routing in the title. A quiet week files nothing and writes one run-log line.

## Running it by hand

```bash
# Everything, writing nothing anywhere:
gh workflow run factory-supervisor.yml -f dry_run=true

# Force the weekly retro:
gh workflow run factory-supervisor.yml -f retro=true
```

Locally, the three file-driven scripts need no credentials:

```bash
npx tsx scripts/supervisor/diff.ts --previous prev.json --current cur.json --out events.json
npx tsx scripts/supervisor/metrics.ts --snapshots state/supervisor/history --out metrics.md
npx tsx scripts/supervisor/retro.ts --outcomes outcomes.json --out retro.md
```

`snapshot.ts`, `actions.ts`, `outcomes.ts` and the publishers need
`NOTION_API_KEY` and/or `FACTORY_TOKEN`, and say so as a `CAPABILITY FAULT` when
they are missing.

## Is the supervisor itself alive?

Per §11: if the page's newest run-log line is more than two hours old **and**
`factory-state` has no commit in the last two hours, the supervisor is down.
Either alone is not evidence — a quiet hour writes a snapshot commit and no run
log line, which is the normal, healthy state.

## Tuning

Every threshold is in `scripts/supervisor/config.ts`, in one block, so it can be
changed without touching the logic that reads it.
