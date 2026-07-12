-- Freeze the structured per-contract job input (including client/site address
-- components resolved from Google Places) alongside the rendered body, so the
-- structured address data persists behind the formatted strings and future
-- features can reuse it. variables_json stays the flat string map the template
-- renderer consumes; job_input_json carries the richer structured input.

alter table contracts
  add column job_input_json jsonb;
