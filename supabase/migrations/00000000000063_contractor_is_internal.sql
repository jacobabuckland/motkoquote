-- Mark internal and test accounts to enable honest metrics.
--
-- Without a flag distinguishing internal/test accounts from real ones, every
-- metric derived from production data silently mixes testing behavior with
-- actual contractor behavior. This has already invalidated headline figures:
-- a 55% invention rate (actually 18.9% when internal accounts are excluded)
-- and a 41% abandonment rate (actually 11 test runs).
--
-- The column defaults to false for all existing rows and all future signups.
-- Setting it true requires an explicit manual update.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'contractors' and column_name = 'is_internal'
  ) then
    alter table contractors add column is_internal boolean not null default false;
  end if;
end $$;

comment on column contractors.is_internal is
  'Marks internal and test accounts. Defaults to false for all contractors. '
  'Set to true manually for identified test accounts (Jacob''s accounts and '
  'Aspire Plastering) to enable future metrics queries to exclude them from '
  'production metrics.';
