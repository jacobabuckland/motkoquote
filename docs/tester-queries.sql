-- Tester observability — ready-to-paste queries for the Supabase SQL editor.
--
-- These read the events / feedback / client_errors tables populated by the
-- observability instrumentation. Everything writes server-side via the service
-- role, so run these as the Supabase owner (the SQL editor already is).
--
-- Replace the ':user_id' / ':contractor_id' placeholders with a real UUID
-- (paste it in quotes, e.g. '00000000-0000-0000-0000-000000000000').


-- 1. Funnel overview per user — how many of each event, most recent first.
--    Use this to see where each tester is in the activation journey.
select
  user_id,
  event,
  count(*) as times,
  max(created_at) as last_seen
from events
group by user_id, event
order by user_id, last_seen desc;


-- 2. Last 50 events for one user — the raw activity stream for a tester.
--    Swap in the user's UUID.
select
  created_at,
  event,
  path,
  session_id,
  properties
from events
where user_id = '00000000-0000-0000-0000-000000000000'
order by created_at desc
limit 50;


-- 3. Voice failures — every failed/abandoned voice session with its stage and,
--    where available, the matching error message logged at the same moment.
select
  e.created_at,
  e.user_id,
  e.event,
  e.properties ->> 'mode'  as mode,
  e.properties ->> 'stage' as stage,
  ce.message               as error_message
from events e
left join client_errors ce
  on ce.source = 'voice'
  and ce.user_id is not distinct from e.user_id
  and ce.created_at between e.created_at - interval '5 seconds'
                        and e.created_at + interval '5 seconds'
where e.event in ('voice_session_failed', 'voice_session_abandoned')
order by e.created_at desc;


-- 4. All feedback — newest first, with who sent it and from which screen.
select
  created_at,
  user_id,
  contractor_id,
  path,
  message
from feedback
order by created_at desc;


-- 5. Errors in the last 24h, grouped by message — the loudest problems first.
select
  message,
  count(*)            as occurrences,
  max(created_at)     as last_seen,
  array_agg(distinct source) as sources,
  array_agg(distinct path)   as paths
from client_errors
where created_at > now() - interval '24 hours'
group by message
order by occurrences desc, last_seen desc;


-- 6. Drop-off checks — for each user, which funnel milestones they have hit.
--    A NULL column is a milestone they have not reached yet, so you can read
--    across a row to see exactly where someone stalled.
select
  user_id,
  min(created_at) filter (where event = 'signup_completed')  as signed_up,
  min(created_at) filter (where event = 'setup_completed')   as setup_done,
  min(created_at) filter (where event = 'voice_session_completed') as first_voice_done,
  min(created_at) filter (where event = 'quote_drafted')     as quote_drafted,
  min(created_at) filter (where event = 'quote_sent')        as quote_sent,
  min(created_at) filter (where event = 'contract_sent')     as contract_sent,
  min(created_at) filter (where event = 'contract_signed')   as contract_signed,
  min(created_at) filter (where event = 'invoice_sent')      as invoice_sent,
  min(created_at) filter (where event = 'invoice_paid')      as invoice_paid
from events
where user_id is not null
group by user_id
order by signed_up nulls last;
