-- RENUMBERED 58 -> 62 on 2026-09-01, and the add is now guarded.
--
-- Same reason as 61: authored as 58, pushed to production from this branch
-- before it merged, and #506 reconciled the ledger to main's version set — where
-- 58 is inventory_excludes_extension_objects. The column is already live, and
-- from main this file's version is unticked, so `db push` will run it against a
-- database that already has the column. Guarded, that is a no-op.
--
-- Half-day rate (V1 of the first-run intake work).
--
-- The other business-level rates — day_rate, overtime_rate, callout_min,
-- travel_rate, markup_pct — have been on contractors since migration 1, are
-- captured conversationally at setup, and are already read by the drafting
-- path. The half day was the one genuinely missing: a great many trade jobs are
-- half a day, and without a rate for one the compiler either doubles a
-- half-day's labour or leaves the line unpriced.
alter table contractors
  add column if not exists half_day_rate numeric(10, 2);

comment on column contractors.half_day_rate is
  'What the trade charges for half a day. Nullable: a trade who only works in '
  'whole days has no answer to give, and an invented one is worse than none.';
