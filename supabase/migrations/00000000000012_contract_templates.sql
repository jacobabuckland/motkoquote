-- Structured contract templates: business-profile fields reused across every
-- contract, plus per-contract template selection and a frozen rendered body
-- (what the customer actually agreed to, independent of later template edits).

alter table contractors
  add column business_profile jsonb not null default '{}'::jsonb;

alter table contracts
  add column template_key text,
  add column variables_json jsonb,
  add column rendered_body text,
  alter column terms_text drop not null;
