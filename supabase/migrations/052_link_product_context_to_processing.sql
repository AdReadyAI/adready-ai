-- product_context becomes one row per video_processing run (task "product_context"),
-- matching every other analyzer output table instead of being a request-keyed upsert.
alter table public.product_context
  drop constraint product_context_pkey,
  drop column request_id,
  add column processing_id uuid not null references public.video_processing(id) on delete cascade;

create index idx_product_context_processing_id on public.product_context (processing_id);
