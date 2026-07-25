create table public.visual_frames (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null,
  image_url text,
  visual_description text not null,
  people jsonb,
  color_palette jsonb,
  background jsonb,
  camera_movement text check (camera_movement in ('static', 'pan', 'zoom', 'handheld')),
  technical_flags text[] not null default '{}',
  primary key (request_id, frame_id)
);

alter table public.visual_frames enable row level security;
grant select, insert, update, delete on public.visual_frames to service_role;
