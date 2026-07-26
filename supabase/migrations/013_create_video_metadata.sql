create table public.video_metadata (
  request_id uuid primary key references public.requests(request_id) on delete cascade,
  duration_ms integer not null,
  aspect_ratio text not null,
  resolution text not null,
  dropped_frame_markers integer[] not null default '{}',
  corruption_detected boolean
);

alter table public.video_metadata enable row level security;
