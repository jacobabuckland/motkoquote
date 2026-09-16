-- Record the VAT split on pre-migration-80 quotes and their invoices.
--
-- THIS IS NOT A SECOND IMPLEMENTATION. `scripts/backfill/record-legacy-vat.ts`
-- is canonical and is the one covered by tests. This file exists because the
-- script needs a service-role key in `.env.local` and the Supabase SQL editor
-- does not, and a one-shot backfill is not worth an environment setup.
--
-- It was validated against the planner rather than written and hoped for: the
-- plan CTEs below were run through the read-only connector on 14 Sep 2026 and
-- diffed row by row against `planLegacyQuoteVat` over the same rows.
--   33 quotes, 21 invoices, zero divergence in shape, subtotal, VAT or
--   per-invoice allocation.
-- If the data has moved since, re-run STEP 1 and diff it against
-- `npx tsx scripts/backfill/record-legacy-vat.ts` before writing.
-- Do NOT edit the rule here without changing the TypeScript first.
--
-- The rule, and why it is recovery rather than guesswork, is documented in
-- src/lib/backfill/legacy-vat-record.ts. In short: total / sum(line items) is
-- either 1.2 or 1.0 because the old code either grossed up or did not, and
-- those are 20% apart, so no rounding window can confuse them. A row matching
-- neither is skipped, never apportioned.
--
-- Mirrors the planner exactly:
--   * each line rounded to 2dp and THEN summed (lineItemTotal rounds per line)
--   * crew lines priced from `people`, ignoring the cached unit_price
--   * `net` tested before `grossed`, so an ambiguous row asserts NO VAT
--   * tolerance = max(0.05, total * 0.001)
--   * the invoice that SETTLES the quote takes the VAT remainder, so the parts
--     sum to the recorded whole
--   * quotes invoiced beyond their own total are skipped entirely
--
-- Never writes `quotes.total`: what the customer was charged does not change
-- here, only what we know about its composition. Never overwrites a recorded
-- figure — the `is null` guards are re-asserted inside the UPDATEs, so a row
-- written between the dry run and the write is left alone.
--
-- EACH STEP IS ONE SELF-CONTAINED STATEMENT. Run them one at a time. An earlier
-- draft used temporary tables across statements; the SQL editor commits each
-- statement on its own, so `on commit drop` destroyed them before the next
-- statement ran. Nothing here depends on anything surviving between steps.


-- ===========================================================================
-- STEP 1 — DRY RUN. Writes nothing. Expect 33 quote rows and 21 invoice rows.
-- ===========================================================================
with lines as (
  select q.id as quote_id, q.total,
         round(
           case when jsonb_typeof(li->'people') = 'array' and jsonb_array_length(li->'people') > 0
             then (select coalesce(sum((p->>'days')::numeric * (p->>'day_rate')::numeric), 0)
                   from jsonb_array_elements(li->'people') p)
                  * coalesce((li->>'multiplier')::numeric, 1)
             else coalesce((li->>'quantity')::numeric, 0) * coalesce((li->>'unit_price')::numeric, 0)
                  * coalesce((li->>'multiplier')::numeric, 1)
                  * coalesce((li->>'people_count')::numeric, 1)
           end, 2) as line_total
  from quotes q
  left join lateral jsonb_array_elements(q.line_items_json) li on true
  where q.subtotal is null or q.vat_amount is null
),
summed as (
  select quote_id, total, round(coalesce(sum(line_total), 0), 2) as items
  from lines group by quote_id, total
),
shaped as (
  select quote_id, total, items,
         greatest(0.05, abs(total) * 0.001) as tol,
         case
           when abs(total - items) <= greatest(0.05, abs(total) * 0.001) then 'net'
           when abs(total - items * 1.2) <= greatest(0.05, abs(total) * 0.001) then 'grossed'
         end as shape
  from summed
  where total > 0 and items > 0
),
quote_plan as (
  select quote_id, total, items, shape, tol,
         case when shape = 'net' then total else items end as new_subtotal,
         case when shape = 'net' then 0 else round(total - items, 2) end as new_vat
  from shaped
  where shape is not null
),
invoiced as (
  select qp.quote_id, coalesce(sum(i.amount), 0) as inv_total
  from quote_plan qp left join invoices i on i.quote_id = qp.quote_id
  group by qp.quote_id
),
eligible as (
  select qp.* from quote_plan qp
  join invoiced v on v.quote_id = qp.quote_id
  where v.inv_total - qp.total <= qp.tol
),
ordered as (
  select i.id as invoice_id, i.quote_id, i.amount, i.vat_amount as existing_vat,
         e.total, e.new_vat,
         sum(i.amount) over (partition by i.quote_id order by i.created_at, i.id
                             rows between unbounded preceding and current row) as cumulative,
         sum(coalesce(i.vat_amount, round(e.new_vat * i.amount / e.total, 2)))
           over (partition by i.quote_id order by i.created_at, i.id
                 rows between unbounded preceding and 1 preceding) as allocated_before
  from invoices i
  join eligible e on e.quote_id = i.quote_id
),
inv_plan as (
  select invoice_id, quote_id,
         case when abs(cumulative - total) < 0.005
              then round(new_vat - coalesce(allocated_before, 0), 2)
              else round(new_vat * amount / total, 2) end as new_vat
  from ordered
  where existing_vat is null
)
select 'quote'   as kind, quote_id::text as id, shape, items::text as line_items,
       new_subtotal::text as subtotal, new_vat::text as vat
from eligible
union all
select 'invoice', invoice_id::text, '', '', '', new_vat::text
from inv_plan
order by kind desc, id;


-- ===========================================================================
-- STEP 2 — APPLY. One statement. Both UPDATEs run against the same snapshot,
-- so the invoice allocation is computed from the pre-update rows, which is what
-- it must be. Returns the two counts — expect 33 and 21.
-- ===========================================================================
with lines as (
  select q.id as quote_id, q.total,
         round(
           case when jsonb_typeof(li->'people') = 'array' and jsonb_array_length(li->'people') > 0
             then (select coalesce(sum((p->>'days')::numeric * (p->>'day_rate')::numeric), 0)
                   from jsonb_array_elements(li->'people') p)
                  * coalesce((li->>'multiplier')::numeric, 1)
             else coalesce((li->>'quantity')::numeric, 0) * coalesce((li->>'unit_price')::numeric, 0)
                  * coalesce((li->>'multiplier')::numeric, 1)
                  * coalesce((li->>'people_count')::numeric, 1)
           end, 2) as line_total
  from quotes q
  left join lateral jsonb_array_elements(q.line_items_json) li on true
  where q.subtotal is null or q.vat_amount is null
),
summed as (
  select quote_id, total, round(coalesce(sum(line_total), 0), 2) as items
  from lines group by quote_id, total
),
shaped as (
  select quote_id, total, items,
         greatest(0.05, abs(total) * 0.001) as tol,
         case
           when abs(total - items) <= greatest(0.05, abs(total) * 0.001) then 'net'
           when abs(total - items * 1.2) <= greatest(0.05, abs(total) * 0.001) then 'grossed'
         end as shape
  from summed
  where total > 0 and items > 0
),
quote_plan as (
  select quote_id, total, items, shape, tol,
         case when shape = 'net' then total else items end as new_subtotal,
         case when shape = 'net' then 0 else round(total - items, 2) end as new_vat
  from shaped
  where shape is not null
),
invoiced as (
  select qp.quote_id, coalesce(sum(i.amount), 0) as inv_total
  from quote_plan qp left join invoices i on i.quote_id = qp.quote_id
  group by qp.quote_id
),
eligible as (
  select qp.* from quote_plan qp
  join invoiced v on v.quote_id = qp.quote_id
  where v.inv_total - qp.total <= qp.tol
),
ordered as (
  select i.id as invoice_id, i.quote_id, i.amount, i.vat_amount as existing_vat,
         e.total, e.new_vat,
         sum(i.amount) over (partition by i.quote_id order by i.created_at, i.id
                             rows between unbounded preceding and current row) as cumulative,
         sum(coalesce(i.vat_amount, round(e.new_vat * i.amount / e.total, 2)))
           over (partition by i.quote_id order by i.created_at, i.id
                 rows between unbounded preceding and 1 preceding) as allocated_before
  from invoices i
  join eligible e on e.quote_id = i.quote_id
),
inv_plan as (
  select invoice_id,
         case when abs(cumulative - total) < 0.005
              then round(new_vat - coalesce(allocated_before, 0), 2)
              else round(new_vat * amount / total, 2) end as new_vat
  from ordered
  where existing_vat is null
),
upd_quotes as (
  update quotes q
  set subtotal = e.new_subtotal,
      vat_amount = e.new_vat,
      vat_rate = 0.2
  from eligible e
  where q.id = e.quote_id
    and q.subtotal is null
  returning q.id
),
upd_invoices as (
  update invoices i
  set vat_amount = p.new_vat,
      vat_rate = 0.2
  from inv_plan p
  where i.id = p.invoice_id
    and i.vat_amount is null
  returning i.id
)
select (select count(*) from upd_quotes) as quotes_written,
       (select count(*) from upd_invoices) as invoices_written;


-- ===========================================================================
-- STEP 3 — VERIFY. Run after STEP 2. Every row returned is a defect.
-- Checks that on any FULLY invoiced quote, the invoices' VAT sums to the
-- quote's recorded VAT. Zero rows is the pass condition.
-- ===========================================================================
select q.id,
       q.vat_amount as quote_vat,
       round(sum(i.vat_amount), 2) as invoice_vat,
       round(sum(i.amount), 2) as invoiced_total,
       q.total
from quotes q
join invoices i on i.quote_id = q.id
where q.vat_amount is not null
group by q.id, q.vat_amount, q.total
having round(sum(i.amount), 2) >= q.total - 0.005
   and abs(coalesce(sum(i.vat_amount), 0) - q.vat_amount) > 0.005;
