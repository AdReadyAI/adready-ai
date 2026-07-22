-- A campaign submission with N videos now fans out to N `requests` rows
-- (one video each, per the pipeline's one-video-per-request_id contract).
-- batch_id groups those rows back together for the loading/results UI.
-- It's stamped with the same client-generated UUID that already scopes the
-- upload session's storage paths, so no new id needs to be minted.
alter table public.requests
  add column batch_id uuid not null default gen_random_uuid();

create index requests_batch_id_idx on public.requests (batch_id);
