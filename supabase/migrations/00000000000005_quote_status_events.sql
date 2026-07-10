alter table quotes add column accepted_at timestamptz;
alter table quotes add column declined_at timestamptz;

-- Public (unauthenticated) customers need read access to a single quote by id
-- when following a tracked link, and to flip status on accept/decline.
-- Accomplished via the service-role admin client server-side, so no RLS
-- policy changes are required for anon access.
