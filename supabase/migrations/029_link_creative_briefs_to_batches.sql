-- Creative Briefs are Campaign Context consumed by evaluator Edge Functions.
-- Persist batch_id alongside request_id so evaluators and the score engine can
-- query every Ad Creative in one Review Request without an extra join.
alter table public.parsed_creative_briefs
  add column batch_id uuid;

-- Existing briefs already belong to one request, so derive their batch link
-- before requiring all future Creative Brief writes to provide it.
update public.parsed_creative_briefs brief
set batch_id = request.batch_id
from public.requests request
where request.request_id = brief.request_id;

alter table public.parsed_creative_briefs
  alter column batch_id set not null;

-- Match the composite identity introduced for issues and score-engine output.
-- This prevents a valid request_id from being paired with another batch.
alter table public.parsed_creative_briefs
  add constraint parsed_creative_briefs_request_batch_fkey
  foreign key (request_id, batch_id)
  references public.requests (request_id, batch_id);

create index parsed_creative_briefs_batch_id_idx
  on public.parsed_creative_briefs (batch_id);
