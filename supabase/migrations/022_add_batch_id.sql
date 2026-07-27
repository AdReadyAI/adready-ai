-- A campaign submission with N videos now fans out to N `requests` rows
-- (one video each, per the pipeline's one-video-per-request_id contract).
-- batch_id groups those rows back together for the loading/results UI.
--
-- Plain ADD COLUMN rather than a table rebuild — Postgres has no ALTER TABLE
-- column-reorder, so batch_id lands at the end of the column list instead of
-- next to request_id. That's cosmetic only (column position has no effect on
-- queries, since columns are resolved by name), and this way the existing
-- video_processing_request_id_fkey and requests' RLS policies/grants never
-- have to be dropped and recreated.

alter table public.requests
  add column batch_id uuid not null default gen_random_uuid();

create index requests_batch_id_idx on public.requests (batch_id);
