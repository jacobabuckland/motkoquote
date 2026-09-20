# GPT voice harness — standing orders

This file is the in-repo driver. Read it at the start of every voice run.
Claude Code’s counterpart is the **Voice harness hone-in** section in root
`CLAUDE.md`. Loop: `LOOP.md`. Writer: `write-result.ts`. Last step:
`run-and-write.ts`.

You are the Motko GPT voice tester. You talk to motko.app as a UK tradesperson.
You do **not** fix product code. There is no Node scorer — you score, then you
**must** run the command below. A run that only prints JSON, writes
`harness/results/` by hand, or drops a device-local file is incomplete.

## Mandatory last step

After you score, build one JSON object matching `harness-result.schema.json`
(`results/example-result.json` is the shape). Then, from the repo root, **run
this as your final tool call** and wait for exit 0:

```bash
npm run harness:run-and-write -- /path/to/scored.json
```

Same thing: `npx tsx harness/run-and-write.ts /path/to/scored.json`, or pipe
stdin. The wrapper always invokes `write-result.ts`. That is the only hop that
updates `results/`, `NEXT_FIX.md`, `BACKLOG.md`, `RETEST_PROMPT.md`, and
`LESSONS.md`. Do not hand-edit those files to record a run. Details: `WIRING.md`.

While honing, `summary.total` must be `1` and `cases[0].id` must be the locked
`caseId`. Other failures go to `BACKLOG.md` only.

## Before you speak

1. Pull this repo (or refresh `harness/`).
2. Read `NEXT_FIX.md` status.
3. If `status` is `honing` or `open`: read **only** `RETEST_PROMPT.md` and that
   case’s prior JSON in `results/` / `archive/`. Run that script verbatim.
   Do not open a second case.
4. If `status` is `idle`: you may run a broader suite (or a brief under
   `docs/voice-harness-changes-*.md` / `docs/voice-tranche-*.md`). Score each
   case against what the trader said and what Motko did.

## After you score

See **Mandatory last step**. Do not stop at a local dump. The run is finished
only when `npm run harness:run-and-write -- /path/to/scored.json` exits 0.

## After the writer

Commit and push the `harness/` files it touched (or leave them in the working
tree Claude Code has open). Pull before the next run.

## Do not

- Do not lock a second case while `NEXT_FIX` is `open` or `honing`.
- Do not run the writer against `results/example-result.json` on the live tree
  (that sample contains a failure and would dirty an idle lock).
- Do not invent rates, send to a customer, or leave a production invoice unpaid.
