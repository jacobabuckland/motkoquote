# S0 — Factory Supervisor: recorded check outcomes

**Audited:** `main` @ `7e2157e` ("Ignore .claude/settings.local.json (#480)"), 31 Aug 2026.
**Repo:** `jacobabuckland/motkoquote` (verified via `git remote -v`).

The spec's staleness caveat applies: every path, workflow and property named in
the spec was a hypothesis. This file records what the code actually shows, and
which §4 branch each check resolved to. Where the spec's hypothesis was wrong
the code wins, and the deviation is written down here rather than absorbed
silently.

---

## §4.1 — Existing workflow and headless invocation pattern

### (a) Headless invocation — **PRESENT → reuse verbatim**

`anthropics/claude-code-action@v1`, used by `factory-pm.yml`,
`factory-engineer.yml` and `factory-qa.yml`. The shape (from
`factory-qa.yml:397`):

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --model claude-sonnet-4-5
      --max-turns 40
      --allowedTools Read,Bash,Glob,Grep,Write
    prompt: |
      …
```

The supervisor's model step reuses this verbatim, with a narrower tool list
(`Read` only — it writes nothing; `publish.ts` does the writing).

### (b) Secrets present in Actions

| Secret | Present | Used by the supervisor |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | model step |
| `NOTION_API_KEY` | yes | snapshot read, publish write |
| `NOTION_DATABASE_ID` | yes | the Roadmap database |
| `FACTORY_TOKEN` | yes | GitHub reads/writes that must not be `GITHUB_TOKEN` |
| `GITHUB_TOKEN` | yes | default |

**Notion secret present → reuse.** No halt.

Not present, and therefore not depended on: any Vercel token (see §4.4).

Two config values the supervisor needs that are **not** secrets and are read
from repo variables, with documented fallbacks in `scripts/supervisor/config.ts`:

- `NOTION_BUGS_DATABASE_ID` — defaults to the id given in the spec,
  `3b91e4f9-08b4-80f0-b9fc-ce518dfa63b3`.
- `SUPERVISOR_PAGE_ID` / `SUPERVISOR_PARENT_PAGE_ID` — see S3 in
  `docs/supervisor/README.md` for the five-step resolution order.

### (c) Existing cron workflows — **present, but none is a generic scheduler**

| Workflow | Cron | Purpose |
|---|---|---|
| `factory-poll-notion.yml` | `17 * * * *` | admits Ready-for-factory items |
| `factory-reconciler.yml` | `*/15 * * * *` | reconciles observed item state |
| `factory-decisions-digest.yml` | `0 7 * * *` | daily halt digest to issue #157 |
| `rls-check.yml` | `30 6 * * *` | live RLS check |

Each is single-purpose and its `concurrency` group is its own. Adding the
supervisor as a job inside any of them would couple two unrelated failure
domains, so per §4.1's second branch: **new workflow file**,
`.github/workflows/factory-supervisor.yml`, cron `43 * * * *` (offset off the
hour for the reason `factory-poll-notion.yml:7` already documents — shared
runners are contended at `:00`, and `:17` is taken).

`factory-state` branch does **not** exist (`git ls-remote --heads origin
factory-state` → empty). The workflow creates it as an orphan branch on first
run.

---

## §4.2 — Where DECISION NEEDED reports land: **STRUCTURED → read from it**

The spec hypothesised a Notion comment. It is not: **halts are GitHub issue
state**, and Notion is a mirror written back to.

**The exact marker:** a comment on the factory issue containing a line matching
`^## DECISION NEEDED`, paired with a *stopped label* on the issue. Composed by
the single composer `scripts/factory/decision-section.sh:72`; the PM enforces
its presence at `factory-pm.yml:1004` ("a block must arrive as an answerable
question").

**Four stopped labels, not one** — taken from the existing daily digest
(`factory-decisions-digest.yml:70-80`), which already had to learn this:

| Label | Meaning |
|---|---|
| `blocked` | a consumer stopped and asked |
| `qa-disputed` | the Engineer says QA is wrong |
| `spec-dispute` | the Engineer says the contract it is judged against is wrong |
| `reconciler-escalated` | nothing can tell where the item is |

`halt_open` is true when the issue carries any of the four **and** is open.
Issues labelled `factory-meta` are excluded (the tracker must never appear in
its own digest).

Notion `Status = "Blocked"` is written from the `blocked` label by
`factory-notion-status.yml`, so it is a *derived mirror* of this signal and is
not read as an independent one.

**No `AGENTS.md` change is needed.** The convention already exists and is
enforced. The spec's §3 permitted exactly one line here if the check went the
other way; it did not, so nothing is added.

---

## §4.3 — Where QA rejections land: **STRUCTURED → read from it**

Also GitHub labels, not Notion comments. The QA agent's three exits
(`factory-qa.yml`):

| Line | Transition | Meaning |
|---|---|---|
| 541 | `verify` → `previewed` | pass |
| 543 | `verify` → `qa-changes` | **rejection — changes requested** |
| 218, 617 | `verify` → `blocked` | rejection that also halts |

`qa_rejections` counts `labeled`/`qa-changes` events on the issue's timeline —
event count, not current-label state, so a rejection that has since been
cleared still counts. `blocked` is already counted as a halt and is not
double-counted as a rejection.

**No `AGENTS.md` change is needed**, for the same reason as §4.2.

---

## §4.4 — Preview deploy status source: **VERCEL TOKEN ABSENT → GitHub Deployments**

No Vercel token exists in Actions secrets, so per §4.4's second branch the
supervisor derives preview status from GitHub Deployment statuses. This is the
same source `factory-deploy.yml:52-70` already uses, and the supervisor reuses
its two hard-won details:

- query `repos/:repo/deployments?ref=<sha>&environment=Preview&per_page=20`,
  then `/deployments/:id/statuses`, and take the **newest** deployment that has
  a `success` status — a retried deploy leaves the older failed one on the same
  SHA;
- Vercel sets `environment_url` on failures too, so the URL is not evidence of
  success.

Where no deployment exists for a ticket, `preview_status` is `unknown`, and
§6 makes `unknown` not a change event.

---

## §4.5 — Ticket ↔ PR linkage: **PROPERTY PRESENT AND POPULATED → use it**

Both directions exist and both are used, in this order:

1. **Notion → GitHub**: the Roadmap page's `GitHub Issue` URL property, written
   by the poller at `poll-notion.mjs:294` and `:311`.
2. **GitHub → Notion**: the issue body's `<!-- notion-page-id: … -->` marker,
   falling back to the visible `**Source:**` Notion link — the exact rule in
   `scripts/factory/notion-page-id.sh`, ported to TypeScript in
   `scripts/supervisor/github.ts` rather than shelled out to.

Direction 2 is kept as the fallback because direction 1 has a known failure
mode the shell script documents at length: a card body edited by hand loses the
HTML comment, and on 30 Aug four items (#403, #436, #438, #443) had silently
diverged as a result. Two sources agreeing is the check; where they disagree
the supervisor reports the ticket as `unlinked` rather than guessing.

The PR itself is `factory/<issue-number>`, the branch convention every factory
workflow uses.

Tickets that resolve to no issue are counted once as `unlinked` in
`notion_health` and are excluded from PR-derived signals (`pr`,
`preview_status`, `halt_open`, `qa_rejections`), exactly as §4.5 requires.

---

## Deviation from the spec, stated plainly

§5's snapshot keys `tickets` by Notion page id, and that is kept. What changed
is where each **field** comes from: `status`, `name`, `module` and
`preview_url` are read from Notion; `halt_open`, `qa_rejections`, `pr` and
`preview_status` are derived from GitHub, because that is where the factory
actually keeps them.

`status_since` is the one field the spec's hard-constraints table is emphatic
about ("from the status-change history, not `last_edited_time`"). The Notion
API exposes no property-change history, so it is derived, in order:

1. the timestamp of the GitHub label event that produced the current status —
   authoritative, since `factory-notion-status.yml` derives Notion's Status
   from exactly those labels;
2. else carried forward from the previous snapshot when the status is unchanged;
3. else the current run's `taken_at`, for a ticket seen for the first time.

`last_edited_time` is never consulted. Recorded as a decision in
`areas/motko.md`.
