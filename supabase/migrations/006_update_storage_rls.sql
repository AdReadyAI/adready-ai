-- Replace the existing anon-wide storage policies with auth.uid()-scoped ones
-- so uploads are scoped per authenticated user.

drop policy if exists "anon can upload files" on storage.objects;
drop policy if exists "anon can delete files" on storage.objects;
drop policy if exists "anon can view files" on storage.objects;

create policy "authenticated users can upload files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "authenticated users can delete own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "authenticated users can view own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
