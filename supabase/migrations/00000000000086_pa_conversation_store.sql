-- PA rebuild, phase 1: the conversation store.
--
-- Four tables, all owned by a contractor and all behind RLS:
--
--   pa_threads          one conversation per contractor (more allowed later)
--   pa_messages         what was said, plus the cards shown and the tools called
--   pa_pending_actions  the confirmation gate. A send / invoice / mark-paid /
--                       delete is only ever executed against a row here that is
--                       the same contractor, the same thread, unexpired and
--                       unspent. The model can create a row; it cannot spend one.
--   pa_draft_assumptions  which of the three pricing slots (pricing mode, crew,
--                       materials supply) the contractor has CONFIRMED on a
--                       chat-made draft. A draft with an unconfirmed slot cannot
--                       be sent.
--
-- Additive only. Apply with `supabase db push` BEFORE deploying the code.
--
-- Erasure: pa_messages, pa_pending_actions cascade from pa_threads, and
-- pa_threads / pa_draft_assumptions are deleted by eraseContractorScopedData.

create table pa_threads (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pa_threads_contractor_idx on pa_threads (contractor_id, updated_at desc);

create table pa_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references pa_threads (id) on delete cascade,
  contractor_id uuid not null references contractors (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  cards jsonb not null default '[]'::jsonb,
  tool_calls jsonb,
  channel text not null default 'app',
  created_at timestamptz not null default now()
);

create index pa_messages_thread_idx on pa_messages (thread_id, created_at);

create table pa_pending_actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references pa_threads (id) on delete cascade,
  contractor_id uuid not null references contractors (id) on delete cascade,
  action text not null check (action in ('send_quote', 'create_invoice', 'mark_paid', 'delete_draft')),
  args jsonb not null,
  summary text not null default '',
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pa_pending_actions_thread_idx on pa_pending_actions (thread_id, created_at desc);

create table pa_draft_assumptions (
  job_id uuid primary key references jobs (id) on delete cascade,
  contractor_id uuid not null references contractors (id) on delete cascade,
  pricing_confirmed_at timestamptz,
  crew_confirmed_at timestamptz,
  materials_confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index pa_draft_assumptions_contractor_idx on pa_draft_assumptions (contractor_id);

-- ---------------------------------------------------------------------------
-- RLS. A contractor reads and writes only their own rows.
-- ---------------------------------------------------------------------------

alter table pa_threads enable row level security;
alter table pa_messages enable row level security;
alter table pa_pending_actions enable row level security;
alter table pa_draft_assumptions enable row level security;

create policy "Owner reads own threads" on pa_threads for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner inserts own threads" on pa_threads for insert
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner updates own threads" on pa_threads for update
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner deletes own threads" on pa_threads for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- A message must sit in a thread the same contractor owns: the contractor_id
-- column alone could otherwise be set to one's own id on another's thread.
create policy "Owner reads own messages" on pa_messages for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner inserts own messages" on pa_messages for insert
  with check (
    contractor_id in (select id from contractors where owner_user_id = auth.uid())
    and thread_id in (
      select t.id from pa_threads t
      join contractors c on c.id = t.contractor_id
      where c.owner_user_id = auth.uid()
    )
  );
create policy "Owner deletes own messages" on pa_messages for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner reads own pending actions" on pa_pending_actions for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
-- A pending action can only be born unspent; spending it is an UPDATE.
create policy "Owner inserts own pending actions" on pa_pending_actions for insert
  with check (
    confirmed_at is null
    and contractor_id in (select id from contractors where owner_user_id = auth.uid())
    and thread_id in (
      select t.id from pa_threads t
      join contractors c on c.id = t.contractor_id
      where c.owner_user_id = auth.uid()
    )
  );
-- The UPDATE policy is deliberately coarse (own rows only); WHAT may change is
-- enforced by the trigger below, because RLS WITH CHECK cannot compare OLD and
-- NEW. The only legitimate update is the claim: confirmed_at null -> now.
create policy "Owner spends own pending actions" on pa_pending_actions for update
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create function pa_pending_actions_claim_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.confirmed_at is not null then
    raise exception 'pa_pending_actions: already confirmed';
  end if;
  if new.confirmed_at is null
     or new.confirmed_at < now() - interval '1 minute'
     or new.confirmed_at > now() + interval '1 minute' then
    raise exception 'pa_pending_actions: confirmed_at may only be set to now';
  end if;
  if new.id is distinct from old.id
     or new.thread_id is distinct from old.thread_id
     or new.contractor_id is distinct from old.contractor_id
     or new.action is distinct from old.action
     or new.args is distinct from old.args
     or new.summary is distinct from old.summary
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'pa_pending_actions: only confirmed_at may change';
  end if;
  if old.expires_at <= now() - interval '1 minute' then
    raise exception 'pa_pending_actions: expired';
  end if;
  return new;
end;
$$;

create trigger pa_pending_actions_claim_only
  before update on pa_pending_actions
  for each row execute function pa_pending_actions_claim_only();

create policy "Owner deletes own pending actions" on pa_pending_actions for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

create policy "Owner reads own draft assumptions" on pa_draft_assumptions for select
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner inserts own draft assumptions" on pa_draft_assumptions for insert
  with check (
    contractor_id in (select id from contractors where owner_user_id = auth.uid())
    and job_id in (select id from jobs where contractor_id = pa_draft_assumptions.contractor_id)
  );
create policy "Owner updates own draft assumptions" on pa_draft_assumptions for update
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()))
  with check (contractor_id in (select id from contractors where owner_user_id = auth.uid()));
create policy "Owner deletes own draft assumptions" on pa_draft_assumptions for delete
  using (contractor_id in (select id from contractors where owner_user_id = auth.uid()));

-- A draft's assumptions row cannot be re-pointed at another job or contractor:
-- only the confirmation timestamps (and updated_at) may change.
create function pa_draft_assumptions_frozen_keys() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_id is distinct from old.job_id
     or new.contractor_id is distinct from old.contractor_id then
    raise exception 'pa_draft_assumptions: job_id and contractor_id cannot change';
  end if;
  return new;
end;
$$;

create trigger pa_draft_assumptions_frozen_keys
  before update on pa_draft_assumptions
  for each row execute function pa_draft_assumptions_frozen_keys();

-- Threads cannot be handed to another contractor.
create function pa_threads_frozen_owner() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contractor_id is distinct from old.contractor_id then
    raise exception 'pa_threads: contractor_id cannot change';
  end if;
  return new;
end;
$$;

create trigger pa_threads_frozen_owner
  before update on pa_threads
  for each row execute function pa_threads_frozen_owner();
