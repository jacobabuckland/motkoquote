-- M7 (#9) — make each chase reminder exactly-once by construction.
--
-- The chase cron loaded an invoice's chase_events, decided a wave was due,
-- SENT the message, then inserted the chase_events row afterwards. Two runs
-- overlapping (a retry, or a manual trigger racing the schedule) both read the
-- same "not yet sent" state and both sent the same wave on the same channel
-- before either recorded it — the in-memory dedup can't stop a concurrent run.
--
-- One reminder per (invoice, channel, wave) is the invariant. This unique index
-- enforces it at the database so the cron can CLAIM before it sends: insert the
-- chase_events row first (conflict => another run already owns this wave, skip),
-- and only dispatch once the claim is won. The cap marker is (invoice, 'cap',
-- 'capped') — also one-per-invoice under the same index.
--
-- template_used is nullable, but every chase/cap row we write sets it, so the
-- Postgres default NULLS DISTINCT behaviour never lets an un-templated row slip
-- past the constraint in practice. Dedupe any pre-existing duplicates first
-- (keep the earliest send) so the index can be created against live data.
delete from chase_events c
using chase_events dup
where c.invoice_id = dup.invoice_id
  and c.channel = dup.channel
  and c.template_used is not distinct from dup.template_used
  and (c.sent_at, c.id) > (dup.sent_at, dup.id);

create unique index chase_events_invoice_channel_template_key
  on chase_events (invoice_id, channel, template_used);
