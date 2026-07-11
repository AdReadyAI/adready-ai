insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 524288000, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

create policy "anon can upload videos"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'videos');

create policy "anon can delete videos"
  on storage.objects for delete
  to anon
  using (bucket_id = 'videos');

create policy "anon can view videos"
  on storage.objects for select
  to anon
  using (bucket_id = 'videos');
