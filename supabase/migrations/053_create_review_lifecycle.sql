-- Review Requests are the user-facing parent of the existing per-creative
-- requests rows. Keeping this identity separate lets history, retries, and
-- deletion operate on a complete submission without leaking the pipeline's
-- one-row-per-video implementation into the website.
create table public.review_requests (
  review_request_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  retry_of_review_request_id uuid references public.review_requests(review_request_id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_requests_retry_is_not_self check (
    retry_of_review_request_id is null
    or retry_of_review_request_id <> review_request_id
  )
);

create index review_requests_user_created_at_idx
  on public.review_requests (user_id, created_at desc)
  where deleted_at is null;

create index review_requests_retry_of_idx
  on public.review_requests (retry_of_review_request_id)
  where retry_of_review_request_id is not null;

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

grant select on public.video_processing to authenticated;

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
select
  review.review_request_id,
  review.retry_of_review_request_id,
  review.created_at,
  count(distinct request.request_id)::integer as creative_count,
  coalesce(
    array_agg(request.video_storage_paths[1] order by request.created_at)
      filter (where request.request_id is not null),
    '{}'::text[]
  ) as creative_paths,
  count(distinct score.request_id)::integer as scored_count,
  count(distinct request.request_id) filter (
    where request.evaluation_completion_status = 'failed'
       or exists (
         select 1
         from public.video_processing processing_failure
         where processing_failure.request_id = request.request_id
           and processing_failure.status = 'error'
       )
  )::integer as failed_count,
  case
    when count(distinct request.request_id) = 0 then 'failed'
    when count(distinct score.request_id) = count(distinct request.request_id)
      then 'completed'
    when count(distinct score.request_id) > 0 and count(distinct request.request_id) filter (
      where request.evaluation_completion_status = 'failed'
         or exists (
           select 1
           from public.video_processing processing_failure
           where processing_failure.request_id = request.request_id
             and processing_failure.status = 'error'
         )
    ) > 0 then 'partially_failed'
    when count(distinct request.request_id) filter (
      where request.evaluation_completion_status = 'failed'
         or exists (
           select 1
           from public.video_processing processing_failure
           where processing_failure.request_id = request.request_id
             and processing_failure.status = 'error'
         )
    ) > 0 then 'failed'
    when count(distinct processing.id) > 0
      or count(distinct request.request_id) filter (
        where request.evaluation_completion_status in ('pending', 'processing')
      ) > 0 then 'processing'
    else 'queued'
  end as status
from public.review_requests review
left join public.requests request
  on request.batch_id = review.review_request_id
left join public.video_processing processing
  on processing.request_id = request.request_id
left join public.result_score_table score
  on score.request_id = request.request_id
where review.deleted_at is null
group by review.review_request_id;

grant select on public.review_request_summaries to authenticated;

-- A complete retry receives a client-minted id, making repeated calls from a
-- double click or network retry idempotent. New per-creative request ids cause
-- the normal insert trigger to enqueue every Media Processing stage again.
create or replace function public.retry_review_request(
  p_source_review_request_id uuid,
  p_new_review_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  source_owner_id uuid;
  existing_retry_source_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;

  select user_id into source_owner_id
  from public.review_requests
  where review_request_id = p_source_review_request_id
    and deleted_at is null;

  if source_owner_id is distinct from caller_id then
    raise exception 'review request not found';
  end if;

  select retry_of_review_request_id into existing_retry_source_id
  from public.review_requests
  where review_request_id = p_new_review_request_id
    and user_id = caller_id;

  if found then
    if existing_retry_source_id is distinct from p_source_review_request_id then
      raise exception 'retry id already belongs to another review request';
    end if;

    -- The whole function is transactional, so an existing retry identity also
    -- means its copied creatives and queue messages committed successfully.
    return p_new_review_request_id;
  end if;

  insert into public.review_requests (
    review_request_id,
    user_id,
    retry_of_review_request_id
  ) values (
    p_new_review_request_id,
    caller_id,
    p_source_review_request_id
  )
  on conflict (review_request_id) do nothing;

  -- Copy Campaign Context before pipeline requests are enqueued so downstream
  -- evaluators can resolve it as soon as processing completes.
  insert into public.parsed_creative_briefs (
    batch_id,
    raw_text,
    destination_platform,
    brand_voice,
    target_audience,
    required_messages,
    required_ctas,
    approved_claims,
    forbidden_claims,
    brand_guidelines,
    policy_requirements
  )
  select
    p_new_review_request_id,
    raw_text,
    destination_platform,
    brand_voice,
    target_audience,
    required_messages,
    required_ctas,
    approved_claims,
    forbidden_claims,
    brand_guidelines,
    policy_requirements
  from public.parsed_creative_briefs
  where batch_id = p_source_review_request_id
  on conflict (batch_id) do nothing;

  insert into public.requests (
    request_id,
    user_id,
    video_storage_paths,
    user_brief,
    product_url,
    campaign_goal,
    product_image_paths,
    logo_paths,
    batch_id
  )
  select
    gen_random_uuid(),
    caller_id,
    video_storage_paths,
    user_brief,
    product_url,
    campaign_goal,
    product_image_paths,
    logo_paths,
    p_new_review_request_id
  from public.requests
  where batch_id = p_source_review_request_id
    and user_id = caller_id
  order by created_at;

  if not found then
    raise exception 'review request has no creatives';
  end if;

  return p_new_review_request_id;
end;
$$;

-- Deletion is intentionally logical: retries share immutable uploaded assets,
-- so physically deleting storage for one attempt could corrupt another. The
-- review and all of its generated results disappear immediately through RLS;
-- a later retention worker can purge unreferenced assets safely.
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

revoke all on function public.retry_review_request(uuid, uuid)
  from public, anon;
revoke all on function public.delete_review_request(uuid)
  from public, anon;
grant execute on function public.retry_review_request(uuid, uuid)
  to authenticated;
grant execute on function public.delete_review_request(uuid)
  to authenticated;
