create table contracts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade unique,
  deposit_pct numeric(5, 2),
  terms_text text not null,
  status text not null default 'sent',
  signer_name text,
  signed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
