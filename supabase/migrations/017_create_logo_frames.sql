create table public.logo_frames (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  frame_id text not null,
  timestamp_ms integer not null,
  location jsonb,
  confidence_score numeric not null,
  prominence text check (prominence in ('large_central', 'small_corner', 'background_signage', 'absent')),
  reference_match text check (reference_match in ('matches_reference', 'differs_from_reference', 'cannot_determine')),
  primary key (request_id, frame_id)
);
