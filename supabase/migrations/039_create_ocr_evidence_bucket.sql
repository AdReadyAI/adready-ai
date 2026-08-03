-- Representative OCR frames are generated Media Evidence, not user uploads.
-- Keep them in a private worker-owned bucket with no end-user object policies.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'ocr-evidence',
  'ocr-evidence',
  false,
  10485760,
  array['image/jpeg']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
