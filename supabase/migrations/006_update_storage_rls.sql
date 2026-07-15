-- Replace the existing anon-wide storage policies with auth.uid()-scoped ones
-- so videos are scoped per authenticated user.

drop policy if exists "anon can upload videos" on storage.objects;
drop policy if exists "anon can delete videos" on storage.objects;
drop policy if exists "anon can view videos" on storage.objects;

create policy "authenticated users can upload videos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "authenticated users can delete own videos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "authenticated users can view own videos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
