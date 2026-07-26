-- L2 — make SMS opt-out a single atomic jsonb merge, not a read-modify-write.
--
-- The Twilio inbound webhook read each matching customer's `contact` jsonb, then
-- wrote back `{ ...contact, sms_opt_out }`. Any concurrent write to the same row
-- (a profile edit, another inbound message) between the read and the write was
-- silently clobbered — the classic lost update. It also stamped opt-out per row
-- fetched in JS, so a row inserted after the SELECT was missed entirely.
--
-- This function merges the single flag in the database in one statement, keying
-- off the phone directly. `||` on jsonb overwrites only `sms_opt_out` and leaves
-- every other key intact, so no read is needed and nothing else is overwritten.
create or replace function set_sms_opt_out(p_phone text, p_opt_out boolean)
returns void
language sql
as $$
  update customers
  set contact = coalesce(contact, '{}'::jsonb)
              || jsonb_build_object('sms_opt_out', p_opt_out)
  where contact->>'phone' = p_phone;
$$;
