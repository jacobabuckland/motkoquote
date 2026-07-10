insert into storage.buckets (id, name, public)
values ('voice-notes', 'voice-notes', false)
on conflict (id) do nothing;

create policy "Users upload own voice notes"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users read own voice notes"
  on storage.objects for select
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
