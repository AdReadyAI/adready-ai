-- Migration 056 makes Review Requests the user-facing parent of per-creative
-- requests rows. Keeping this identity separate lets history and
-- deletion operate on a complete submission without leaking the pipeline's
-- one-row-per-video implementation into the website.
create table public.review_requests (
  review_request_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index review_requests_user_created_at_idx
  on public.review_requests (user_id, created_at desc)
  where deleted_at is null;

-- Preserve every existing batch as a first-class Review Request.
insert into public.review_requests (review_request_id, user_id, created_at)
select batch_id, user_id, min(created_at)
from public.requests
group by batch_id, user_id
on conflict (review_request_id) do nothing;

-- A batch belongs to exactly one user. The composite key lets the foreign key
-- below enforce that invariant while retaining requests.user_id for existing
-- ownership policies and worker queries.
alter table public.review_requests
  add constraint review_requests_id_user_unique
  unique (review_request_id, user_id);

alter table public.requests
  add constraint requests_review_request_fkey
  foreign key (batch_id, user_id)
  references public.review_requests (review_request_id, user_id);

alter table public.requests
  add constraint requests_request_id_user_unique
  unique (request_id, user_id);

-- Existing upload clients create requests rows directly. Materialize their
-- Review Request before the foreign key is checked so rollout is backwards
-- compatible and the parent timestamp matches the first creative submitted.
create or replace function public.ensure_review_request_on_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.review_requests (review_request_id, user_id, created_at)
  values (new.batch_id, new.user_id, new.created_at)
  on conflict (review_request_id) do nothing;

  return new;
end;
$$;

create trigger trg_ensure_review_request_on_request_insert
  before insert on public.requests
  for each row
  execute function public.ensure_review_request_on_request_insert();

-- The original enqueue trigger used an unqualified function name. A retry runs
-- inside a security-definer function with an intentionally empty search path,
-- so qualify the queue seam to keep the existing insert behavior available.
create or replace function public.enqueue_job_on_request_insert()
returns trigger
language plpgsql
as $$
begin
  perform public.enqueue_job(
    jsonb_build_object(
      'request_id', new.request_id,
      'bucket', 'uploads',
      'video_path', new.video_storage_paths[1],
      'product_image_paths', new.product_image_paths,
      'logo_paths', new.logo_paths
    )
  );
  return new;
end;
$$;

grant select on public.review_requests to authenticated;

alter table public.review_requests enable row level security;

create policy "users read own review requests"
  on public.review_requests for select to authenticated
  using (user_id = auth.uid() and deleted_at is null);

-- Authenticated clients can observe lifecycle state, but production diagnostics
-- remain service-role-only. RLS controls rows; these column grants separately
-- control which parts of an owned row may cross the browser boundary.
revoke select on public.requests from authenticated;
grant select (
  request_id,
  user_id,
  video_storage_paths,
  user_brief,
  product_url,
  campaign_goal,
  product_image_paths,
  logo_paths,
  created_at,
  batch_id,
  evaluation_completion_status,
  evaluation_completion_attempts,
  evaluation_completion_started_at,
  evaluation_completion_completed_at,
  agents_triggered_at,
  media_processing_status
) on public.requests to authenticated;

grant select (request_id, status) on public.video_processing to authenticated;

create policy "users read own video processing"
  on public.video_processing for select to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = video_processing.request_id
        and requests.user_id = auth.uid()
    )
  );

-- One ownership-aware projection is the read interface for the history page.
-- security_invoker keeps the underlying requests/video_processing/result RLS
-- active instead of granting the view creator's privileges to callers.
create view public.review_request_summaries
with (security_invoker = true)
as
with review_creatives as (
  select
    review.review_request_id,
    review.created_at as review_created_at,
    request.request_id,
    request.created_at as creative_created_at,
    request.video_storage_paths[1] as creative_path,
    request.evaluation_completion_status,
    score.request_id is not null as scored,
    request.evaluation_completion_status = 'failed'
      or exists (
        select 1
        from public.video_processing processing_failure
        where processing_failure.request_id = request.request_id
          and processing_failure.status = 'error'
      ) as failed,
    exists (
      select 1
      from public.video_processing processing
      where processing.request_id = request.request_id
    ) as has_processing
  from public.review_requests review
  left join public.requests request
    on request.batch_id = review.review_request_id
  left join public.result_score_table score
    on score.request_id = request.request_id
  where review.deleted_at is null
)
select
  review_request_id,
  review_created_at as created_at,
  count(request_id)::integer as creative_count,
  coalesce(
    array_agg(creative_path order by creative_created_at)
      filter (where request_id is not null),
    '{}'::text[]
  ) as creative_paths,
  count(request_id) filter (where scored)::integer as scored_count,
  count(request_id) filter (where failed)::integer as failed_count,
  coalesce(
    array_agg(request_id order by creative_created_at) filter (where failed),
    '{}'::uuid[]
  ) as failed_request_ids,
  case
    when count(request_id) = 0 then 'failed'
    when count(request_id) filter (where scored) = count(request_id)
      then 'completed'
    -- A Review Request is terminal only after every Ad Creative is either
    -- scored or terminally failed. This keeps successful work in progress
    -- visible instead of letting one early failure end the whole request.
    when count(request_id) filter (where scored or failed) = count(request_id)
      and count(request_id) filter (where scored) > 0
      and count(request_id) filter (where failed) > 0
      then 'partially_failed'
    when count(request_id) filter (where scored or failed) = count(request_id)
      and count(request_id) filter (where failed) > 0
      then 'failed'
    when count(request_id) filter (
      where has_processing
        or evaluation_completion_status in ('pending', 'processing')
    ) > 0 then 'processing'
    else 'queued'
  end as status
from review_creatives
group by review_request_id, review_created_at;

grant select on public.review_request_summaries to authenticated;

-- Deletion is intentionally logical. The review and all of its generated
-- results disappear immediately through RLS; a later retention worker can
-- purge unreferenced uploaded assets safely.
create or replace function public.delete_review_request(
  p_review_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Generated data cascades from requests. Remove the batch-scoped brief first
  -- because its table intentionally has no foreign key to the review parent.
  delete from public.parsed_creative_briefs
  where batch_id = p_review_request_id
    and exists (
      select 1
      from public.review_requests
      where review_request_id = p_review_request_id
        and user_id = auth.uid()
        and deleted_at is null
    );

  delete from public.requests
  where batch_id = p_review_request_id
    and user_id = auth.uid();

  update public.review_requests
  set deleted_at = now()
  where review_request_id = p_review_request_id
    and user_id = auth.uid()
    and deleted_at is null;

  return found;
end;
$$;

revoke all on function public.delete_review_request(uuid)
  from public, anon;
grant execute on function public.delete_review_request(uuid)
  to authenticated;
