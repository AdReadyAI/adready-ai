create table public.parsed_creative_briefs (
  request_id uuid primary key references public.requests(request_id) on delete cascade,
  raw_text text not null,
  brand_voice text,
  target_audience text,
  required_messages text[] not null default '{}',
  required_ctas text[] not null default '{}',
  approved_claims text[] not null default '{}',
  forbidden_claims text[] not null default '{}',
  brand_guidelines text[] not null default '{}',
  policy_requirements text[] not null default '{}'
);

create table public.product_context (
  request_id uuid primary key references public.requests(request_id) on delete cascade,
  raw_text text,
  claims text[] not null default '{}',
  contraindications text[] not null default '{}',
  reference_asset_urls text[] not null default '{}'
);

create table public.video_metadata (
  video_id uuid primary key references public.request_videos(video_id) on delete cascade,
  duration_ms integer not null check (duration_ms >= 0),
  aspect_ratio text not null,
  resolution text not null,
  dropped_frame_markers integer[] not null default '{}',
  corruption_detected boolean
);

create table public.ocr_segments (
  id uuid primary key default gen_random_uuid(),
  processing_id uuid not null references public.video_processing(id) on delete cascade,
  video_id uuid not null references public.request_videos(video_id) on delete cascade,
  ocr_id text not null,
  frame_ids text[] not null default '{}',
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  text text not null,
  on_screen_duration_ms integer not null check (on_screen_duration_ms >= 0),
  region_size numeric,
  font_size_px integer check (font_size_px >= 0),
  unique (video_id, ocr_id)
);

create table public.visual_frames (
  id uuid primary key default gen_random_uuid(),
  processing_id uuid not null references public.video_processing(id) on delete cascade,
  video_id uuid not null references public.request_videos(video_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null check (timestamp_ms >= 0),
  image_url text,
  visual_description text not null,
  people jsonb,
  color_palette jsonb,
  background jsonb,
  camera_movement text check (camera_movement in ('static', 'pan', 'zoom', 'handheld')),
  technical_flags text[] not null default '{}',
  unique (video_id, frame_id)
);

create table public.product_frames (
  id uuid primary key default gen_random_uuid(),
  processing_id uuid not null references public.video_processing(id) on delete cascade,
  video_id uuid not null references public.request_videos(video_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null check (timestamp_ms >= 0),
  location jsonb,
  confidence_score numeric not null check (confidence_score between 0 and 1),
  prominence text check (prominence in ('foreground_in_use', 'foreground_static', 'background', 'not_visible')),
  focus_quality text check (focus_quality in ('sharp', 'soft_focus', 'blurry')),
  framing text check (framing in ('fully_visible', 'partially_cropped', 'heavily_obscured')),
  usage_context text,
  unique (video_id, frame_id)
);

create table public.logo_frames (
  id uuid primary key default gen_random_uuid(),
  processing_id uuid not null references public.video_processing(id) on delete cascade,
  video_id uuid not null references public.request_videos(video_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null check (timestamp_ms >= 0),
  location jsonb,
  confidence_score numeric not null check (confidence_score between 0 and 1),
  prominence text check (prominence in ('large_central', 'small_corner', 'background_signage', 'absent')),
  reference_match text check (reference_match in ('matches_reference', 'differs_from_reference', 'cannot_determine')),
  unique (video_id, frame_id)
);
