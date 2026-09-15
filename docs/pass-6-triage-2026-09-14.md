# Pass 6 triage — 14 Sep 2026

Read against `main` @ `f1a1efa`, with production read through the Supabase
connector (read-only). Rows are cited by id; the tester's own first-name labels
appear once, in the cross-reference column, so their report can be matched up.

## The headline: three of the four CRITICALs were fixed hours after the tester read them

The two contract defects landed in **different commits, 19½ hours apart**:

| Fix | Commit | Merged (UTC) |
|---|---|---|
| Labour/Materials derivation — only `category === "materials"` is materials | `9f1ae79` | 13 Sep **17:35:27** |
| Contract reads the quote's *recorded* VAT instead of recomputing from the flag | `6efed61` | 14 Sep **13:01:46** |

`contracts.rendered_body` and `variables_json` are written once, at generation,
and never again. So each contract is a snapshot of whichever fixes existed at
its `created_at`. That single fact explains CRITICAL 1, CRITICAL 2 and half of
CRITICAL 4, and the generation timestamps prove it:

| Contract | Generated (UTC) | vs fixes | Clause 2 as stored |
|---|---|---|---|
| `bd4ecb13` (Rhys) | 14 Sep **09:43:42** | after labour fix, **3h18m before** the VAT fix | Labour £740 ✓, VAT £148 ✗ |
| `c25d2a40` (Dee) | 13 Sep **21:18:04** | after labour fix, before VAT fix | Labour £1,200 ✓, VAT £240 ✗ |
| `26208b87` (Megan, 13 Sep) | 13 Sep **12:54:59** | **before both** | Labour £0 ✗, VAT £0 |
| `6785a014` (9 Sep) | 9 Sep | before both | Labour £0 ✗, VAT £360 ✗ |
| `baf3d18f` | 14 Sep **13:20:36** | **after both** | Labour £600 ✓, VAT £0 ✓ |

Rhys's contract shows the new labour rule and the old VAT rule **because that is
exactly the code that existed at 09:43 on 14 Sep.** It is not a regression and
it is not still being written — but it was live for 19½ hours, and the tester
caught the window.

**Verify the deploy before anything else.** The data cannot distinguish "fixed
and deployed" from "fixed and merged but not shipped", because no contract has
been generated since 13:20 with registration on. Generate one £X quote with
registration ON against a quote whose recorded `vat_amount` is `0.00` and read
clause 2. If it says VAT £0.00, the fix is live and CRITICAL 1 and 2 are closed
for new documents.

### Rhys's row, for the record

| Surface | Subtotal | VAT | Total |
|---|---|---|---|
| `quotes.cec0c4f4` (recorded) | 740.00 | **0.00** | 740.00 |
| `invoices` ×2 | — | 0.00, 0.00 | 222.00 + 518.00 = 740.00 |
| `contracts.bd4ecb13` clause 2 | 740.00 | **148.00** | 888.00 |

The quote and both invoices agree at £740 with VAT recorded as zero. The
contract is the single outlier, and its `variables_json` is a snapshot. Nothing
recomputes on read, which is why the tester's toggle-and-reload produced a
byte-identical clause 2 — correctly.

## CRITICAL 3 is real, live, and the one genuinely new defect

Pass 5 made a legacy quote show its **stored total and no VAT**. That is right
when the stored total is net. It is wrong when the old code had already grossed
it up, because the line items then don't sum to the total and the page has
nothing left to explain the gap.

The shape is decidable from the row. Across all quotes:

- **26 legacy quotes** (`subtotal IS NULL`) store `total ≈ sum(line items) × 1.2`
- the rest store `total = sum(line items)`

Of the 20 legacy quotes carrying invoices with no recorded VAT:

| Shape | Quotes | What the sixth-of-gross fallback does |
|---|---|---|
| `total = items × 1.2` | 13 | **Exactly right** — the old code multiplied by 1.2 |
| `total = items` | 7 | **Invents VAT that was never charged** |

The tester's example, `b3112196` (Megan, 3 Sep): total £540.00, line items
£450.00, `subtotal`/`vat_amount` both null. £540 = £450 × 1.2. The £90 is VAT
the old code added; the page now shows the £540 and asserts no VAT, so the
customer sees £450 of items under a £540 total with a live Accept button.

## D14 — what's recorded and what's guessed

`paidInvoiceVat` falls back to gross ÷ 6 for any invoice with no recorded
`vat_amount`. **24 of 33 invoices** have none; £33,269.92 of paid invoices are
being guessed at.

Split by the shape test above, the guess divides cleanly:

| | Gross | Sixth |
|---|---|---|
| Correct reconstruction (`grossed_20pct`) | — | ~£1,785 |
| Invented (`net_no_vat`) | — | ~£1,760 |

The invented half is concentrated in two rows: `539ae51e` (£9,056 → £1,509.33)
and `881e998e` (£1,414 → £235.67). Both quotes store `total = items`, so neither
carries any VAT at all.

So the tester's reconstruction is right about the mechanism and can now be made
precise: the fallback is not uniformly invented — it is **exactly right for 13
quotes and wrong for 7**, and the row says which.

## "Owed (net)" — same root, one line of code

`money-position-actions.ts:536` still nets unpaid invoices with `splitFeeVat()`
gated on `isVATRegistered` — the live flag. It is the last recompute-from-flag
site on the money card, and the tester's toggle proof is exact: flag off →
£450.00, flag on → £375.00 on an invoice (`f49d1260`) whose quote stores
`total = items` and therefore carries no VAT at all. £450 is the right answer.

Reading the record instead would remove the toggle dependence, but `f49d1260`
has no record to read — which is why this resolves with the backfill below
rather than on its own.

## The keystone: one backfill closes four findings

Every one of CRITICAL 3, CRITICAL 2's invoice/contract disagreement, D14's
invented VAT, and Owed (net) is the same missing fact — legacy quotes carry no
recorded VAT split — and the split is recoverable from the row:

```
grossed_20pct:  subtotal = sum(line items),  vat_amount = total − subtotal
net_no_vat:     subtotal = total,            vat_amount = 0
```

then `invoices.vat_amount` from `invoiceVatFor`'s proportional share.

**`grossed_20pct` is arithmetic, not judgement** — the old code literally
computed `subtotal × 1.2`, so recording it restates what the code did.

**`net_no_vat` looked like a tax question and is not.** The concern was that a
registered trader's stated price is VAT-inclusive whatever the document says, so
the honest record might be `subtotal = total / 1.2`. But every contract carries
a `vat_registered` snapshot taken at generation, and **all seven** of these
quotes were generated while the trade was not registered:

| Quote | Contract generated | Registered then? |
|---|---|---|
| `881e998e` | 13 Sep | no |
| `f49d1260` | 13 Sep | no |
| `539ae51e` | 12 Sep | no |
| `bb7de2ba` | 15 Aug | no |
| `a2760274` | 13 Aug | no |
| `88790830` | 14 Jul | no |
| `90d691d8` | 12 Jul | no |

So `vat_amount = 0` is correct for all of them, and the backfill is arithmetic
end to end. It is still a money write against production and still irreversible,
so it is still Jacob's to authorise — but there is no open sub-question inside
it.

## Fixed this session

**The VAT on a split quote now sums to what the quote recorded** (`617f3d8`).
`invoiceVatFor` takes the invoices already raised; the one that settles the
quote gets the remainder rather than its own rounded share. Harriet's penny:
`3e6de1ad` records £603.38, its 25/75 split landed both shares on a half-penny,
both rounded up, and two receipts headed VAT INVOICE claimed £603.39 between
them. Affects invoices raised from here on; the rows already written still carry
the penny. Full suite green (468 files, 5811 tests).

## Open, needing a decision

1. **The legacy VAT backfill** — money and an irreversible write, but no open
   sub-question: every value is derivable from the rows. See above.
2. **Signed contracts stating the wrong total.** `planContractRepair`
   (`repair-stored-contract.ts:109`) deliberately **refuses signed contracts**:
   "A signed contract is the document the customer agreed to." It also doesn't
   touch VAT/total. So `bd4ecb13` and `c25d2a40` cannot be corrected by existing
   tooling by design, and the remedy is a human one — reissue or an addendum —
   not a silent rewrite. Unsigned pre-14-Sep contracts *could* be repaired by
   extending the script to the VAT trio.
3. **Zero rows in clause 2.** The clause-2 table
   (`templates.ts:160-163`, `315-318`) is a fixed four-row markdown table.
   `Materials | £0.00` and `VAT | £0.00` always render; the `{{#vat_registered}}`
   section guards only the VAT-number suffix, not the row. Suppressing them is a
   change to signed contract copy, so it is on the escalation list and has no
   recorded decision. Note the template engine is single-pass and non-recursive,
   so the VAT row cannot simply be wrapped — it already contains a section, and
   nesting would leak `{{#vat_registered}}` into the document. The row's label
   needs precomputing as a variable first.

## Confirmed, no action

- **Ines — job can never close.** Both refusals are correct
  (`invoice-amount.ts:82,122`): a 100% deposit leaves nothing to invoice. The
  defect is that the tracker and dashboard have no state for "fully invoiced and
  fully paid via deposit alone", so the job stays under "Accepted quotes
  awaiting invoice" forever. State-machine fix, not a guard fix. SERIOUS is right.
- **0%-deposit loop.** The tester's SERIOUS rating and sequencing advice stand.
- **503s.** `api/monitoring/route.ts` returns 404/400/200/502 and never 503, so
  the 503s are not ours — platform or proxy. Not diagnosable from the tree.

## Cross-reference

| Tester label | Quote | Contract |
|---|---|---|
| Rhys | `cec0c4f4` | `bd4ecb13` |
| Dee | `7076212e` | `c25d2a40` |
| Megan 3 Sep | `b3112196` | — (archived) |
| Megan 13 Sep | `f49d1260` | `26208b87` |
| Harriet | `3e6de1ad` | `04dcbbd5` |
| Priya | `881e998e` | `e5d8a3be` |
| Ines | `eeac959e` | `baf3d18f` |
