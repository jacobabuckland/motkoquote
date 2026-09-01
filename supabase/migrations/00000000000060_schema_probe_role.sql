-- A role the schema probe can actually use.
--
-- scripts/ci/schema-probe.ts reads information_schema.columns to compare what
-- the code references against what production has. Neither existing credential
-- can do that job:
--
--   agent_readonly is NOLOGIN (00000000000044) and holds select on four tables.
--   information_schema.columns is filtered by privilege — a role sees only the
--   tables it has some privilege on — so even with the login half provisioned
--   the probe would see jobs, quotes, contracts and invoices and report every
--   column of every other table as missing from production. That is false drift
--   on nearly every pull request, which is worse than the check not running.
--
--   postgres can write, and the probe refuses a credential that can: it proves
--   read-only before it reads, so a superuser connection string fails closed.
--
-- Hence a third role that is exactly what the probe needs and nothing else:
-- log in, see every table in public, change nothing.
--
-- NOLOGIN and no password here, for the same reason as 00000000000044: a
-- password committed to a public repository is a leaked credential the moment
-- it is pushed. The login half is provisioned out of band by a human --
--
--     alter role schema_probe with login password '<generated>';
--
-- -- and the value goes into SUPABASE_READONLY_URL as the connection string's
-- password, never into this file.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'schema_probe') then
    create role schema_probe nologin;
  end if;
end
$$;

-- Start from nothing, then grant back only what is needed, so a future
-- default-privilege change cannot quietly widen this.
revoke all on all tables in schema public from schema_probe;
revoke all on all sequences in schema public from schema_probe;
revoke all on all functions in schema public from schema_probe;
revoke all on schema public from schema_probe;

grant usage on schema public to schema_probe;
grant select on all tables in schema public to schema_probe;

-- Future tables too. Without this a table added next month is invisible to the
-- probe, and invisible reads as "not on production" — the probe would fail
-- every PR referencing it, and the fix would look like a schema problem rather
-- than a grant problem.
--
-- This applies to tables created by the role that runs migrations. That is how
-- every table in this schema is created, so it covers them; a table created by
-- some other role would need granting explicitly.
alter default privileges in schema public grant select on tables to schema_probe;

-- Explicitly NOT granted: insert, update, delete, truncate, references,
-- trigger, usage on sequences, execute on functions. The probe's own read-only
-- verification attempts an insert into `events` and requires it to be refused
-- with a privilege error, so any of these being granted turns the check red
-- rather than going unnoticed.

-- Down migration (for rollback):
-- drop owned by schema_probe;
-- drop role if exists schema_probe;
