alter table public.product_frames
  drop constraint product_frames_pkey,
  drop column request_id,
  drop column usage_context,
  add column processing_id uuid not null references public.video_processing(id) on delete cascade;

create index idx_product_frames_processing_id on public.product_frames (processing_id);

alter table public.logo_frames
  drop constraint logo_frames_pkey,
  drop column request_id,
  add column processing_id uuid not null references public.video_processing(id) on delete cascade;

create index idx_logo_frames_processing_id on public.logo_frames (processing_id);
