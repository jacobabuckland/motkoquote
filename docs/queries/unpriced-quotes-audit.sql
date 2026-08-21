-- How many quotes carry a line the compiler could not price?
--
-- READ-ONLY. Not run against production by the change that added it — hand it
-- to someone who can, and read the answer before deciding what to do about the
-- rows it finds.
--
-- Context: a labour line with no rate behind it is written with
-- `"unpriced": true` and a zero amount. The send path has blocked those since
-- the UNRESOLVED_RATE_FLAG guard landed, and the customer-facing quote page and
-- PDF now both say "To be confirmed" rather than printing £0.00. What this
-- query answers is how much history predates those guards.

-- 1. Quotes carrying an explicitly unpriced line, by status.
--    'sent' or later here means a customer has, or had, a live link to a quote
--    with a missing figure.
select
  q.status,
  count(*)                                              as quotes,
  min(q.created_at)                                     as earliest,
  max(q.created_at)                                     as latest
from quotes q
where exists (
  select 1
  from jsonb_array_elements(q.line_items_json) as item
  where (item ->> 'unpriced')::boolean is true
)
group by q.status
order by quotes desc;

-- 2. The same rows, itemised, for the ones that reached a customer.
select
  q.id            as quote_id,
  q.job_id,
  q.status,
  q.total,
  q.sent_at,
  q.accepted_at,
  jsonb_array_length(q.line_items_json)                 as line_count,
  (
    select count(*)
    from jsonb_array_elements(q.line_items_json) as item
    where (item ->> 'unpriced')::boolean is true
  )                                                     as unpriced_lines
from quotes q
where q.status <> 'draft'
  and exists (
    select 1
    from jsonb_array_elements(q.line_items_json) as item
    where (item ->> 'unpriced')::boolean is true
  )
order by q.sent_at desc nulls last;

-- 3. The legacy shape, which carries NO marker at all.
--    Rows written before `unpriced` existed cannot be detected by the flag, so
--    this looks for the symptom instead: a labour line priced at zero, or a
--    crew whose every member is on a zero day rate. Expect false positives —
--    a deliberate £0 goodwill line looks identical — so treat the output as a
--    list to review, never as a list to mutate.
select
  q.id            as quote_id,
  q.job_id,
  q.status,
  q.total,
  q.created_at,
  item ->> 'description'                                as line_description
from quotes q,
     lateral jsonb_array_elements(q.line_items_json) as item
where (item ->> 'unpriced') is null
  and item ->> 'category' = 'labour'
  and (
    coalesce((item ->> 'unit_price')::numeric, 0) = 0
    or (
      jsonb_typeof(item -> 'people') = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(item -> 'people') as person
        where coalesce((person ->> 'day_rate')::numeric, 0) > 0
      )
    )
  )
order by q.created_at desc;
