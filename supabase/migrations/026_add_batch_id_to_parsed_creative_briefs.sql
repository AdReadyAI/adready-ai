-- Keep request_id as the existing per-video primary key and add batch_id only
-- as a campaign/upload grouping field. This is intentionally nullable so
-- existing request-level brief writers keep working during the frontend/worker
-- transition.

alter table public.parsed_creative_briefs
  add column batch_id uuid;

-- Every existing brief is already tied to one request, so copy that request's
-- batch_id without changing the primary key or request foreign key.
update public.parsed_creative_briefs brief
set batch_id = request.batch_id
from public.requests request
where request.request_id = brief.request_id;

create index parsed_creative_briefs_batch_id_idx
  on public.parsed_creative_briefs (batch_id);
