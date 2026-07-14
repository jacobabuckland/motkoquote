-- Business logo storage. Logos are shown on public customer-facing quote and
-- contract pages and embedded in generated PDFs, so the bucket is public-read
-- (stable, non-expiring URLs that @react-pdf/renderer can fetch). Writes are
-- RLS-scoped to the owner's own folder so a contractor can only add, replace,
-- or remove their own logo — the object path is `{auth.uid()}/...`.
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "Users upload own logo"
  on storage.objects for insert
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users update own logo"
  on storage.objects for update
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own logo"
  on storage.objects for delete
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
