-- request_id is now minted client-side (see CampaignForm's submit) so the
-- requests insert is idempotent across retries: a retry re-sends the same
-- primary keys and ON CONFLICT DO NOTHING skips them, which also keeps
-- trg_enqueue_job_on_request_insert (FOR EACH ROW) from firing a second time
-- and enqueueing a duplicate pipeline run per video.
--
-- Dropping the default makes that mandatory rather than conventional. An
-- insert that omits request_id now fails on the primary key's not-null
-- constraint instead of silently minting an id that no retry can ever match
-- — which would reintroduce the duplicate-batch bug with nothing to notice.
--
-- Safe to drop: CampaignForm is the only writer to public.requests, and it
-- always supplies request_id. Nothing seeds or backfills this table.

alter table public.requests
  alter column request_id drop default;
