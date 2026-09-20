# Motko iterative hone-in loop

One behaviour at a time. Do not widen scope mid-loop.

```
GPT finds a specific failure
        ↓
run-and-write.ts → write-result.ts locks NEXT_FIX.md to that single case
        ↓
    Claude Code fixes + merges
        ↓
Write RETEST_PROMPT.md for GPT (narrow, exact)
        ↓
GPT re-runs only that case → run-and-write.ts (always calls write-result.ts)
        ↓
pass → archive + clear lock → pick next finding
fail → keep same lock, tighten fix, repeat
```

Rules:
- While a case is `status: honing`, ignore other failures except to note them in a backlog file.
- GPT’s next run must use `RETEST_PROMPT.md`, not the broad suite.
- After every scored run, call `npm run harness:run-and-write -- /path/to/scored.json` (`GPT_HARNESS.md`). The wrapper always invokes `write-result.ts`.
- Only after that case is `passed` twice in a row (or once with explicit sign-off) do you open the next finding.
