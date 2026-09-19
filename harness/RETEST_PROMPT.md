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

Overwrite `harness/results/<runId>.json` with a single-case run (`summary.total = 1`).
If **failed**: keep `harness/NEXT_FIX.md` on this same `caseId`, bump `attempts`, put the new transcript in Evidence.
If **passed**: set this file’s `status: clean`, set `NEXT_FIX.md` to `status: idle`, archive the result JSON.

## Out of scope for this retest

Pricing amounts, VAT wording, contract/invoice generation, unrelated trades.
