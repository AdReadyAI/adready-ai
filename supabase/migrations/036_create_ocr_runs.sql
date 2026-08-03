-- One durable OCR Run belongs to the existing one-video Review Request.
-- Queue redelivery resolves through request_id instead of creating duplicate
-- OCR work or expanding the generic worker request contract.
create table public.ocr_runs (
  ocr_run_id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references public.requests(request_id) on delete cascade,

  source_bucket text not null
    check (length(btrim(source_bucket)) > 0),
  source_path text not null
    check (length(btrim(source_path)) > 0),

  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),

  timing_source text
    check (
      timing_source is null
      or timing_source in (
        'presentation_timestamps',
        'constant_frame_rate'
      )
    ),
  fallback_fps numeric
    check (fallback_fps is null or fallback_fps > 0),

  error text
    check (error is null or length(error) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    timing_source = 'constant_frame_rate'
    or fallback_fps is null
  ),
  check (
    timing_source is distinct from 'constant_frame_rate'
    or fallback_fps is not null
  )
);

alter table public.ocr_runs enable row level security;

-- OCR Run lifecycle is worker-owned. Result retrieval and authenticated-user
-- policies belong to the later immutable OCR Result slice.
grant select, insert, update
  on table public.ocr_runs
  to service_role;
