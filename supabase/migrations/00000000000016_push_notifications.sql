-- Push notification subsystem (channel-generalised: web push + APNs).
-- One contractor (auth user) may register many subscriptions: several browsers
-- via VAPID web push, plus one or more iOS devices via APNs once the app ships.
-- Sends are best-effort; the tables here are the source of truth for who to
-- reach and which event categories they have muted.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('webpush', 'apns')),
  -- Web push (VAPID) fields.
  endpoint text,
  p256dh text,
  auth text,
  -- APNs field.
  device_token text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each channel must carry the fields it needs and nothing from the other.
  constraint push_subscriptions_channel_shape check (
    (platform = 'webpush' and endpoint is not null and p256dh is not null and auth is not null and device_token is null)
    or
    (platform = 'apns' and device_token is not null and endpoint is null)
  )
);

-- A given browser endpoint / device token registers once per user; re-registering
-- upserts rather than duplicating.
create unique index push_subscriptions_webpush_uidx
  on push_subscriptions (user_id, endpoint)
  where platform = 'webpush';
create unique index push_subscriptions_apns_uidx
  on push_subscriptions (user_id, device_token)
  where platform = 'apns';

-- Per-user notification preferences. `disabled_events` holds the event ids the
-- contractor has muted; an empty array (the default) means every event is on.
create table notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  disabled_events text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;

create policy "Users manage own push subscriptions"
  on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users manage own notification preferences"
  on notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
