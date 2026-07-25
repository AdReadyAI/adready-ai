create table public.product_frames (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null,
  location jsonb,
  confidence_score numeric not null,
  prominence text check (prominence in ('foreground_in_use', 'foreground_static', 'background', 'not_visible')),
  focus_quality text check (focus_quality in ('sharp', 'soft_focus', 'blurry')),
  framing text check (framing in ('fully_visible', 'partially_cropped', 'heavily_obscured')),
  usage_context text,
  primary key (request_id, frame_id)
);
