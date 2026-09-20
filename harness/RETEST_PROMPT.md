# RETEST_PROMPT (for GPT voice harness)

> Harness: run **only** this case. Do not explore adjacent behaviours. Pass/fail against the acceptance checks only.

```yaml
runId: ""           # fill after the run
caseId: quote-rewire-three-bed
severity: high
trade: electrician
fixPr: ""           # PR that claimed to fix this
status: ready       # ready | honing | clean
attempts: 0
```

## Exact behaviour under test

Crew size and materials from one spoken job description must land on the quote.

## Script the tradesperson must say (verbatim)

Full rewire on a three-bed semi. Ten sockets down, five up, new consumer unit. Two of us, five days.

## Pass only if all of these are true

1. Quote shows **2** electricians (not 1).
2. Labour duration is **5 days**.
3. There is a **consumer unit / materials** line (or Motko clearly asks for materials before finalising — and does not silently drop it).
4. Nothing is sent to the customer without an explicit send.

## Fail if any of these happen

- Crew size ignored or defaulted to 1
- Consumer unit omitted with no follow-up question
- Motko invents rates or line items the trader did not say
- Auto-send or “already sent” language

## What to write back

Build a single-case JSON (`summary.total = 1`) matching `harness-result.schema.json`,
then emit it through the in-repo writer — do not drop a device-local file:

```bash
npx tsx harness/write-result.ts /path/to/run.json
```

The writer keeps this `caseId` if the retest failed (bumps `attempts`, refreshes
Evidence), or archives the JSON, idles `NEXT_FIX.md`, sets this file `clean`, and
appends `LESSONS.md` if it passed. See `GPT_HARNESS.md` and `WIRING.md`.

## Out of scope for this retest

Pricing amounts, VAT wording, contract/invoice generation, unrelated trades.
