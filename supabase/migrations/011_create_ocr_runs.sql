-- Stable Ad Creative identity separates durable Media Processing records from
-- mutable Storage paths carried by legacy request payloads.
create table public.ad_creatives (
  ad_creative_id uuid primary key,
  request_id uuid not null
    references public.requests(request_id) on delete cascade,
  source_bucket text not null check (length(source_bucket) > 0),
  source_path text not null check (length(source_path) > 0),
  created_at timestamptz not null default now(),

  unique (ad_creative_id, request_id)
);

create index ad_creatives_request_id_idx
  on public.ad_creatives(request_id);

-- The caller supplies ocr_run_id. Queue redelivery reuses it, while an
-- intentional rerun receives a new identifier and therefore a new immutable
-- result lineage.
create table public.ocr_runs (
  ocr_run_id uuid primary key,
  ad_creative_id uuid not null,
  request_id uuid not null,
  status text not null
    check (status in ('processing', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (ad_creative_id, request_id)
    references public.ad_creatives(ad_creative_id, request_id)
    on delete cascade
);

create index ocr_runs_ad_creative_id_idx
  on public.ocr_runs(ad_creative_id);

create index ocr_runs_request_id_idx
  on public.ocr_runs(request_id);

alter table public.ad_creatives enable row level security;
alter table public.ocr_runs enable row level security;
