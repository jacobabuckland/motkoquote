-- The contractor's own first name. Motko captures it conversationally at the
-- start of a voice session ("what's your name?") and uses it to greet them by
-- name and in wrap-up. Nullable: it may never be captured, and it's distinct
-- from company_name (the business's trading name) — a person, not a business.
alter table contractors add column first_name text;
