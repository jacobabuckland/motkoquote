-- STAGE-3: Extend automatic chasing to unsettled stages

-- Add due_date to payment_stages so a stage can be overdue before an invoice exists
alter table payment_stages
  add column due_date date;

-- Make chase_events.invoice_id nullable and add stage_id so chase events can be
-- about either an invoice or a stage
alter table chase_events
  alter column invoice_id drop not null;

alter table chase_events
  add column stage_id uuid references payment_stages(id);

-- Exactly one of invoice_id or stage_id must be set — a chase event is about
-- either an invoice or a stage, never both, never neither
alter table chase_events
  add constraint chase_events_target_check
    check ((invoice_id is null) <> (stage_id is null));
