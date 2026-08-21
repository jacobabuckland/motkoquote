-- V4: a read-only role for agent sessions, so a voice defect can be diagnosed
-- against the stored transcript instead of inferred.
--
-- The 21 Aug 2026 voice-intake investigation could not classify the failing
-- job's transcript against its resulting payload (stated / discarded / never
-- asked / invented) because the session had no database access at all. That
-- classification separates an intake defect from an extraction defect in
-- minutes; without it the investigation reached a probabilistic answer where a
-- definitive one existed in the data.
--
-- SCOPE — read-only, four tables, nothing else.
--
--   jobs       transcript, conversation_json, sow_json — the diagnostic itself
--   quotes     the resulting payload to classify the transcript against
--   contracts  downstream state
--   invoices   downstream state
--
-- Deliberately NOT reachable, and each for a reason:
--
--   push_subscriptions  carries APNs device_token and VAPID p256dh/auth —
--                       live push credentials, not diagnostic data
--   contractors,        account and rate data with no bearing on transcript
--   team_members,       classification
--   rate_cards, …
--   auth.*, storage.*,  Supabase-managed; users, sessions, tokens, objects
--   vault.*
--
-- PII NOTICE. These four tables carry customer personal data: jobs.transcript,
-- jobs.conversation_json and jobs.sow_json contain the customer's name, site
-- address, phone and email as captured during intake, and contracts carries
-- signer_name and signed_at. That was surfaced explicitly and the access was
-- authorised on 2026-08-21 with the exposure known — see areas/motko.md. This
-- role reads real customer PII; treat anything it returns accordingly, and do
-- not widen it without a fresh decision.

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- NOLOGIN, and no password here. A password committed to git is a leaked
-- credential the moment it is pushed, so the login half is provisioned out of
-- band by a human:
--
--     alter role agent_readonly with login password '<generated>';
--
-- and the value goes into the factory's secret store, never into this file.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_readonly') then
    create role agent_readonly nologin;
  end if;
end
$$;

-- Start from nothing, then grant back only what is needed. This also undoes
-- anything a future default-privilege change might otherwise hand the role.
revoke all on all tables in schema public from agent_readonly;
revoke all on all sequences in schema public from agent_readonly;
revoke all on all functions in schema public from agent_readonly;
revoke all on schema public from agent_readonly;

-- Read the schema, but never create in it.
grant usage on schema public to agent_readonly;

-- ---------------------------------------------------------------------------
-- The grants — SELECT only, on exactly four tables
-- ---------------------------------------------------------------------------
--
-- Writes are refused because the privilege was never granted, so an insert,
-- update or delete fails at the database rather than by convention. There is
-- no code path or policy to forget.
grant select on table jobs to agent_readonly;
grant select on table quotes to agent_readonly;
grant select on table contracts to agent_readonly;
grant select on table invoices to agent_readonly;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Every table in this schema has row level security enabled, and the existing
-- policies are scoped to auth.uid(). A direct connection carries no JWT, so
-- auth.uid() is null and the role would read zero rows.
--
-- The fix is a read policy per table, NOT the bypassrls role attribute.
-- bypassrls would lift the role above RLS on every table in the database at
-- once — including the ones deliberately withheld above — so a later
-- `grant select` mistake would silently expose far more than intended. These
-- policies grant exactly what the grants above already scope, and cannot
-- reach a table that was never granted.
--
-- `for select` and `to agent_readonly` together mean these add no capability
-- to any other role, and none of them can authorise a write.
create policy "agent_readonly reads jobs" on jobs
  for select to agent_readonly using (true);

create policy "agent_readonly reads quotes" on quotes
  for select to agent_readonly using (true);

create policy "agent_readonly reads contracts" on contracts
  for select to agent_readonly using (true);

create policy "agent_readonly reads invoices" on invoices
  for select to agent_readonly using (true);

-- ---------------------------------------------------------------------------
-- Future tables must not be picked up automatically
-- ---------------------------------------------------------------------------
--
-- Without this, a default-privilege grant added later could extend this role
-- to tables nobody reviewed against the PII notice above. Adding a table to
-- this role is a deliberate act, in a migration, with a decision behind it.
alter default privileges in schema public revoke all on tables from agent_readonly;
alter default privileges in schema public revoke all on sequences from agent_readonly;
alter default privileges in schema public revoke all on functions from agent_readonly;
