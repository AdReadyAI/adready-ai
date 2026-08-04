create table public.quality_frames (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null,
  reasons text[] not null default '{}',
  sharpness numeric,
  crushed_frac numeric,
  blown_frac numeric,
  mean_luma numeric,
  contrast numeric,
  grain numeric,
  blockiness numeric,
  temporal_delta numeric,
  primary key (request_id, frame_id)
);

grant select on public.quality_frames to authenticated;

alter table public.quality_frames enable row level security;

create policy "users read own quality frames"
  on public.quality_frames
  for select
  to authenticated
  using (
    request_id in (
      select request_id from public.requests
      where user_id = auth.uid()
    )
  );
