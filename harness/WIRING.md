# How this harness writes a run

The GPT voice tester is the files in this directory plus the voice briefs under
`docs/`. Scoring is prompt-driven (no Node scorer). After a scored run, the
**required last step** is `run-and-write.ts`, which always calls
`write-result.ts` — that is the in-repo hop that updates the hone-in files. Do
not drop a file only on the device, and do not invent a second copy of
`NEXT_FIX.md` in chat.

Standing orders: `GPT_HARNESS.md`.

## Command

From a clone of `jacobabuckland/motkoquote` (same tree Claude Code has open),
GPT must end every scored run with:

```bash
npm run harness:run-and-write -- /path/to/scored.json
```

or

```bash
npx tsx harness/run-and-write.ts /path/to/scored.json
```

or pipe stdin. The wrapper always invokes `write-result.ts` (same flags:
`--harness-root`, stdin via `-`). Direct writer:

```bash
npx tsx harness/write-result.ts /path/to/run.json
npm run harness:write-result -- /path/to/run.json
```

`--harness-root` overrides the directory (defaults to `harness/` next to the script).

Exit codes: `0` wrote and updated files; `1` invalid JSON / schema / runId /
usage; `2` I/O. A rejected `runId` (unsafe characters, or the reserved
`example-result`) is a payload error and exits `1`, so a harness that retries
on `2` does not retry it forever.

## Payload

The JSON must match `harness/harness-result.schema.json` (see
`harness/results/example-result.json`). Required top-level fields:

`schemaVersion` (`"1.0.0"`), `runId`, `startedAt`, `finishedAt`, `environment`,
`summary`, `cases` (at least one).

`runId` becomes the filename `harness/results/<runId>.json`. Use letters,
numbers, and `._-@+` only. Do not use `example-result`.

While `NEXT_FIX.md` is `honing`, send **one** case — the locked `caseId` in
`RETEST_PROMPT.md` — with `summary.total = 1`. If a multi-case payload arrives,
the writer keeps only that case and notes any other failures in `BACKLOG.md`.

## What the writer does

| `NEXT_FIX` status | Incoming run | Files touched |
|-------------------|--------------|----------------|
| `idle` + failures | lock `summary.topFailureCaseId` (else highest-severity fail) as `status: open`; other fails → `BACKLOG.md` | `results/<runId>.json`, `NEXT_FIX.md`, `BACKLOG.md` |
| `idle` + all pass | record only | `results/<runId>.json` — lock stays idle |
| `open` | same `caseId` may refresh Evidence; a **different** `caseId` is never written into the lock | result + maybe `BACKLOG.md` |
| `honing` + locked case **fails** | bump `attempts`, refresh Evidence, keep the same `caseId` | result, `NEXT_FIX.md`, `RETEST_PROMPT.md` |
| `honing` + locked case **passes** | archive JSON, idle the lock, `RETEST` `status: clean`, one `LESSONS.md` bullet | `results/archive/<runId>.json`, `NEXT_FIX.md`, `RETEST_PROMPT.md`, `LESSONS.md` |

An `open` or `honing` lock is never replaced by a different case. That is the
whole hone-in rule.

The writer does **not** write `RETEST_PROMPT.md` for a newly locked case.
Claude Code does that after the fix merges (`CLAUDE.md` → Voice harness hone-in).

## After the writer

Commit and push the `harness/` changes (or leave them in the working tree Claude
Code can see). Pull before the next GPT run so both sides share one lock.

```bash
git add harness/results/<runId>.json harness/NEXT_FIX.md harness/BACKLOG.md
git commit -m "Harness run <runId>"
git push
```

On a clean retest, add `harness/results/archive/`, `LESSONS.md`, and
`RETEST_PROMPT.md` instead of the active result file.

## Local check without dirtying the lock

The committed `harness/results/example-result.json` is a **sample** with a
failure. Do not point the writer at the live `harness/` with that file — it
would lock `quote-rewire-three-bed`. Exercise the CLI against a temp
`--harness-root` (the unit tests do this).
