create table public.ocr_segments (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  ocr_id text not null,
  frame_ids text[] not null default '{}',
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  on_screen_duration_ms integer not null,
  region_size numeric,
  font_size_px integer,
  primary key (request_id, ocr_id)
);

alter table public.ocr_segments enable row level security;
