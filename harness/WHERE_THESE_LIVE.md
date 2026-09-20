# Where these files live

## Source of truth: Motko GitHub repo

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Standing orders for Claude Code (merge `CLAUDE_CODE_STANDING_PROMPT.md` here). Versioned with the app. |
| `harness/LOOP.md` | Human + LLM description of the hone-in loop |
| `harness/NEXT_FIX.md` | Locked case Claude is fixing / honing |
| `harness/RETEST_PROMPT.md` | Exact prompt GPT must use for the next voice retest |
| `harness/LESSONS.md` | Accumulated learnings from clean cases |
| `harness/BACKLOG.md` | Other failures deferred while honing |
| `harness/harness-result.schema.json` | Result JSON shape |
| `harness/results/<runId>.json` | Runs (active) |
| `harness/results/archive/` | Past runs — context for later LLMs |
| `harness/GPT_HARNESS.md` | Standing orders for the GPT voice tester |
| `harness/write-result.ts` | In-repo writer: validates a run and updates the files above |
| `harness/run-and-write.ts` | Canonical last step after a scored run — always calls the writer |
| `harness/WIRING.md` | How this harness emits a run (command + file updates) |

## Claude Code

- Open the Motko repo clone.
- Do **not** keep a second private copy of NEXT_FIX / RETEST only inside the Claude UI.
- Optional: paste a one-liner in Claude’s user preferences: “Always follow CLAUDE.md and harness/NEXT_FIX.md.”

## GPT voice harness

- Lives in this repo: standing orders in `GPT_HARNESS.md`, briefs under
  `docs/voice-harness-*.md` / `docs/voice-tranche-*.md`, last step
  `run-and-write.ts` (always calls `write-result.ts`).
- Pull `harness/` before a run / push after. After each scored run:
  `npm run harness:run-and-write -- /path/to/scored.json` — see `WIRING.md`.
- While honing: read only `RETEST_PROMPT.md` + that case’s prior JSON in `results/` / `archive/`.
- On clean: the writer appends `LESSONS.md`.

## Motko Test Bot (this assistant)

- Reads the same GitHub paths once the repo is connected.
- Does not replace Claude Code; bridges and can tighten RETEST / LESSONS when asked.
