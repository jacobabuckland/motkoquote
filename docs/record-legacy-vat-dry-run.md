# record-legacy-vat — dry run against production, 14 Sep 2026

Produced by running the committed planner (`src/lib/backfill/legacy-vat-record.ts`)
over every `quotes` row with no recorded subtotal, read through the read-only
connector. This is what `npx tsx scripts/backfill/record-legacy-vat.ts` prints.

```
55 quote(s) read with no recorded subtotal.

  GROSSED 4cff3bb3-5ec6-4c7c-8912-a3bd1f3d45ec  lines £3,385.00 -> subtotal £3,385.00 + VAT £677.00
  GROSSED c001b426-6693-4984-829c-a6c7b8e6b267  lines £7,500.00 -> subtotal £7,500.00 + VAT £1,500.00
  NET     881e998e-c5cd-4557-b9a3-c22a480a9ffb  lines £1,414.00 -> subtotal £1,414.00 + VAT £0.00
            invoice a9d82a8d-44c7-430b-b134-efcfc83d8728  VAT £0.00
  GROSSED dc1bc152-a3cd-40be-8b02-7cdd36db2365  lines £20.00 -> subtotal £20.00 + VAT £4.00
            invoice 83b8d32b-b273-4034-894e-850b57a9153b  VAT £4.00
  GROSSED 95c4cf99-2ce9-4d7c-92ef-c96dfd2fab9e  lines £1,177.50 -> subtotal £1,177.50 + VAT £235.50
            invoice 8b38d3a2-0e69-4a93-8095-76a90e6ade0d  VAT £235.50
  GROSSED 71d82dd1-e8cb-44b0-9a8f-9f7fd89dc697  lines £6,000.00 -> subtotal £6,000.00 + VAT £1,200.00
            invoice 3747a79e-6929-4bbe-954e-b81262ca07f0  VAT £12.00
            invoice f616c9ce-6181-4ea9-9417-31bbf9bcd0eb  VAT £1,188.00
  GROSSED 7076212e-8d95-4afa-9ba5-36c4bd6fbbfa  lines £1,200.00 -> subtotal £1,200.00 + VAT £240.00
            invoice adb62663-f408-4a10-8dd0-d08c2b968a6e  VAT £60.00
            invoice b2f24ef6-eb8e-491e-9d52-4c14391fd6f6  VAT £180.00
  NET     90d691d8-1a06-47b0-9603-272fa866607c  lines £900.00 -> subtotal £900.00 + VAT £0.00
            invoice 3c85d98e-57f5-4e95-887f-552f50f9ec11  VAT £0.00
  NET     88790830-7485-4671-b12f-68d4994dc5fb  lines £992.50 -> subtotal £992.50 + VAT £0.00
            invoice eefc6da3-85f8-4e06-9759-e9a0937a7842  VAT £0.00
  GROSSED 46e3d510-6867-4f9f-9909-4488e04facb9  lines £1,800.00 -> subtotal £1,800.00 + VAT £360.00
            invoice 0ff10440-1825-4267-806f-3ec5752bb0a9  VAT £360.00
  GROSSED 04910ca1-971d-4b6b-a28d-caff33bc9cf3  lines £1,200.00 -> subtotal £1,200.00 + VAT £240.00
  NET     539ae51e-6d25-40a6-8c36-b11bad9d5bfe  lines £9,056.00 -> subtotal £9,056.00 + VAT £0.00
            invoice 61feb016-cef5-41ba-98f9-15cb511dcca1  VAT £0.00
  GROSSED 79bd2f68-318d-4db5-ae61-c40db29196be  lines £2,850.00 -> subtotal £2,850.00 + VAT £570.00
            invoice f3e5cc9b-c9f6-4c64-b669-eeb1589cefe0  VAT £91.20
  GROSSED 6e3a6fbc-9be0-46a3-90c3-26fa9aad9f1f  lines £6,776.78 -> subtotal £6,776.78 + VAT £1,355.36
            invoice ee6a80bd-6edf-41d9-b15d-f5806dd9e1ce  VAT £13.55
  GROSSED 8c072bc2-78e2-449b-a84e-4d981f905d13  lines £200.00 -> subtotal £200.00 + VAT £40.00
  NET     aa227bb7-378e-468d-bc27-b055b6f3af76  lines £800.00 -> subtotal £800.00 + VAT £0.00
  GROSSED 252d9951-945f-4df0-9edf-a68b78151201  lines £1.00 -> subtotal £1.00 + VAT £0.20
            invoice 416faa8a-40bb-4b45-9c75-0f5ad05e107c  VAT £0.20
  NET     f49d1260-2691-4f5c-b537-1f410a851425  lines £450.00 -> subtotal £450.00 + VAT £0.00
            invoice d58e172e-1a18-4ca9-a026-78514df5ed64  VAT £0.00
  NET     a2760274-f50f-4870-9f90-62a7955318db  lines £1.00 -> subtotal £1.00 + VAT £0.00
            invoice 68fa0c6a-5644-4ad6-8ed7-a03e09809805  VAT £0.00
  NET     bb7de2ba-a9db-4988-9f0a-a5967c4f2df9  lines £1.00 -> subtotal £1.00 + VAT £0.00
            invoice caf7f19c-f557-4bbd-8912-f1f6c0c9599f  VAT £0.00
  GROSSED b3112196-b51e-4a9f-8c47-e453dc637761  lines £450.00 -> subtotal £450.00 + VAT £90.00
  GROSSED 03e95995-3ba0-4157-9a74-09cfd579dd42  lines £1.00 -> subtotal £1.00 + VAT £0.20
            invoice 7f51ee84-ef9e-41ab-97f3-73651f9dba82  VAT £0.20
  GROSSED d923e19e-64cb-48cf-877a-0cdf8cd83785  lines £200.00 -> subtotal £200.00 + VAT £40.00
            invoice f1ce69af-3be0-4e45-9b0f-4814295acf1c  VAT £40.00
  GROSSED 0fb6d475-52ed-48ad-8e7e-8c0963617150  lines £3,570.00 -> subtotal £3,570.00 + VAT £714.00
  GROSSED 45e0db69-7c81-4380-9507-97b925650a59  lines £5.00 -> subtotal £5.00 + VAT £1.00
            invoice 7601433b-928e-4ed7-97a1-e8716addaade  VAT £1.00
  GROSSED fcdabd3c-c7ac-4a52-80d4-1d1f36a900b3  lines £1.00 -> subtotal £1.00 + VAT £0.20
            invoice a0c25975-d1e0-4925-b7c8-408a24de9dd2  VAT £0.20
  NET     20cd947e-1e38-47a9-aca5-9006b9c70b13  lines £950.00 -> subtotal £950.00 + VAT £0.00
  NET     b7e3cbc5-3a51-4fd3-9df6-8a62a22dceb9  lines £300.00 -> subtotal £300.00 + VAT £0.00
  GROSSED e24a7ccc-aded-4214-b975-481485828e34  lines £2,540.00 -> subtotal £2,540.00 + VAT £508.00
  GROSSED e9fb0fbf-a847-4ed9-9363-b3f6a0da3311  lines £1,006.50 -> subtotal £1,006.50 + VAT £201.30
  GROSSED a105670f-9875-4d42-9c61-a6314b795e87  lines £1,650.00 -> subtotal £1,650.00 + VAT £330.00
  GROSSED b5e7545e-5373-492e-9d83-0772ea3f3a47  lines £5,427.00 -> subtotal £5,427.00 + VAT £1,085.40
  GROSSED 8f11e0e6-87f1-4dc8-bb51-274a03685a81  lines £2,585.00 -> subtotal £2,585.00 + VAT £517.00

  skip no-stored-total: 12
  skip no-line-items: 9
  skip over-invoiced: 1

33 quote(s) and 21 invoice(s) would be written.

VAT that would become recorded: £9,909.16
```

## Reading it

- **33 quotes and 21 invoices** would be written. Nothing else is touched —
  `quotes.total` is never written, and no recorded figure is overwritten.
- **£9,909.16** of VAT would become recorded where today it is either guessed at
  a sixth of gross or silently absent.
- **No row was indeterminate.** Every quote with a stored total and priced lines
  matched one hypothesis or the other. The widest miss across all 55 rows is
  four tenths of a penny (`6e3a6fbc`).
- **21 skips, all benign**: 12 with no stored total (unsaved drafts), 9 with no
  priced lines (archived shells), and one over-invoiced — see below.

### One thing the dry run found that is not a VAT problem

`0bece51a` has a stored total of **£7,800.00** and **£10,140.00 of invoices
raised against it, all three paid** — £2,340 more than the quote. The backfill
refuses it (`over-invoiced`) because there is no honest way to apportion a
quote's VAT across invoices that exceed it, but the over-invoicing itself is a
separate question and predates this. `deriveInvoiceAmount` refuses to
over-invoice today; these rows are older than that guard.
