# Motko voice harness → Claude Code bridge (iterative)

Hone **one** behaviour until GPT says it’s clean, then move on.

**Where files live:** see `WHERE_THESE_LIVE.md` — GitHub repo is source of truth; Claude Code and GPT both read/write `harness/` in that repo. Do not keep the loop only inside Claude’s UI.

See `LOOP.md` for the diagram.

| File | Repo path | Role |
|------|-----------|------|
| `CLAUDE_CODE_STANDING_PROMPT.md` | merge into root `CLAUDE.md` | Standing orders + context load order |
| `LOOP.md` | `harness/LOOP.md` | Hone-in loop |
| `NEXT_FIX.md` | `harness/NEXT_FIX.md` | Locked case |
| `RETEST_PROMPT.md` | `harness/RETEST_PROMPT.md` | Narrow GPT retest |
| `LESSONS.md` | `harness/LESSONS.md` | Memory across runs |
| `harness-result.schema.json` | `harness/harness-result.schema.json` | Result shape |
| `example-result.json` | reference | Sample run |

## States

| NEXT_FIX status | Who acts | What happens |
|-----------------|----------|--------------|
| `idle` | Harness / you | Finding → lock one case |
| `open` | Claude Code | Fix + merge |
| `honing` | GPT then Claude | GPT runs RETEST only; fail → Claude again; pass → idle + LESSONS bullet |
| RETEST `clean` | — | Case done; archive |
