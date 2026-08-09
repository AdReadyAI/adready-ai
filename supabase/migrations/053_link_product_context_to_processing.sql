-- product_context becomes one row per video_processing run (task "product_context"),
-- matching every other analyzer output table instead of being a request-keyed upsert.
-- Existing rows have no single video_processing run to backfill processing_id from,
-- so they're cleared rather than migrated -- callers re-derive this from scratch per run.
truncate table public.product_context;

alter table public.product_context
  drop constraint product_context_pkey,
  drop column request_id,
  add column processing_id uuid not null references public.video_processing(id) on delete cascade;

create index idx_product_context_processing_id on public.product_context (processing_id);

-- product_context is now a real task like every other analyzer output, so its
-- task_name must be allowed through the same video_processing whitelist.
alter table public.video_processing
  drop constraint video_processing_task_name_check;

alter table public.video_processing
  add constraint video_processing_task_name_check
  check (task_name in ('transcription', 'ocr', 'product_detection', 'logo_detection', 'context', 'product_context'));
