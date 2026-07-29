insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  false,
  524288000,
  array['video/mp4', 'video/quicktime', 'video/webm', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "anon can upload files"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'uploads');

create policy "anon can delete files"
  on storage.objects for delete
  to anon
  using (bucket_id = 'uploads');

create policy "anon can view files"
  on storage.objects for select
  to anon
  using (bucket_id = 'uploads');
