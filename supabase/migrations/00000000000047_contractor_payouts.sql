-- "Deposited": the second money state.
--
-- "Paid" means the customer paid — unchanged, still driven by
-- payment_intent.succeeded. This table records the OTHER half: money leaving
-- Stripe on its way to the contractor's own bank. Until now the product had no
-- way to say that had happened, which is the whole of "marked as paid but no
-- monies was received": both halves of that sentence were true and only one of
-- them was visible.
--
-- Contractor-level, not per-job, deliberately. One Stripe payout aggregates
-- many transfers, so attributing it back to individual jobs means a four-hop
-- live chain (payout -> balance transaction -> transfer -> charge -> intent).
-- A trade wants to know their money arrived, not which pound came from which
-- job, so v1 answers the question that was actually asked.

create table contractor_payouts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,

  -- Stripe's payout id on the CONNECTED account. Unique because Stripe retries
  -- webhook delivery and a duplicate row would double-count a payout on a
  -- screen whose entire job is telling a trade what they received.
  stripe_payout_id text not null unique,

  amount_pennies int not null,
  currency text not null default 'gbp',

  -- 'paid'   — Stripe sent it. NOT a guarantee it has landed; see arrival_date.
  -- 'failed' — it did not go. Must never read as money received.
  status text not null check (status in ('paid', 'failed')),

  -- Stripe's own ESTIMATE of when the money reaches the bank. BACS can take
  -- another working day after 'paid', so every surface shows this alongside the
  -- state rather than the state alone — a bare "deposited" is exactly the class
  -- of overclaim that caused the original complaint.
  arrival_date timestamptz,

  -- Populated on failure so support has something to act on instead of a
  -- contractor describing a screen.
  failure_message text,

  created_at timestamptz not null default now()
);

create index contractor_payouts_contractor_idx
  on contractor_payouts (contractor_id, created_at desc);

alter table contractor_payouts enable row level security;

-- Owner-read only. A contractor sees their own payouts and nobody else's.
-- Writes come from the webhook via the service role, which bypasses RLS, so
-- there is deliberately no insert/update/delete policy here: nothing but the
-- webhook may create a payout record.
create policy "Contractors read own payouts"
  on contractor_payouts for select
  using (
    contractor_id in (
      select id from contractors where owner_user_id = auth.uid()
    )
  );
