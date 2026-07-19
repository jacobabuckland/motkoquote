-- Contractor-directed flags for a drafted quote — verification requests, rate
-- uncertainty, or people mentioned in the call who aren't in team_members.
-- These are the second note channel (see the drafting pricing contract):
-- customer_note renders on documents, contractor_flag NEVER does. Stored as
-- JSON on the quote (a simple string array) rather than a new table, since
-- they're transient editor-only prompts tied to one quote draft.
alter table quotes add column contractor_flags_json jsonb not null default '[]'::jsonb;
