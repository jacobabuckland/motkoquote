-- Half-day rate (V1 of the first-run intake work).
--
-- The other business-level rates — day_rate, overtime_rate, callout_min,
-- travel_rate, markup_pct — have been on contractors since migration 1, are
-- captured conversationally at setup, and are already read by the drafting
-- path. The half day was the one genuinely missing: a great many trade jobs are
-- half a day, and without a rate for one the compiler either doubles a
-- half-day's labour or leaves the line unpriced.
alter table contractors
  add column half_day_rate numeric(10, 2);

comment on column contractors.half_day_rate is
  'What the trade charges for half a day. Nullable: a trade who only works in '
  'whole days has no answer to give, and an invented one is worse than none.';
