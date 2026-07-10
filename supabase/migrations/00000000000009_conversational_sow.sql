-- Conversational Statement of Work (Stage 2): the running conversation and
-- structured SoW state built up over a multi-turn voice loop, before a job
-- is complete enough to draft a quote.
alter table jobs add column conversation_json jsonb not null default '[]'::jsonb;
alter table jobs add column sow_json jsonb;
