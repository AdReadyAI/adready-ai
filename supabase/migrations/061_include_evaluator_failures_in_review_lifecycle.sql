-- Include terminal evaluator failures in the Review Request history projection.
-- Live progress reads individual evaluator_runs rows; this view owns the
-- coarser Review Request status shown after the user leaves the progress page.
create or replace view public.review_request_summaries
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
    score.request_id is null
      and (
        request.evaluation_completion_status = 'failed'
        or (
          request.media_processing_status = 'failed'
          and request.agents_triggered_at is null
        )
        or exists (
          select 1
          from public.evaluator_runs evaluator_run
          where evaluator_run.request_id = request.request_id
            and evaluator_run.status in (
              'dispatch_failed',
              'failed',
              'timed_out'
            )
        )
      ) as failed,
    request.media_processing_status in ('pending', 'processing')
      or exists (
        select 1
        from public.video_processing processing
        where processing.request_id = request.request_id
      )
      or exists (
        select 1
        from public.evaluator_runs evaluator_run
        where evaluator_run.request_id = request.request_id
          and evaluator_run.status in ('pending', 'dispatched', 'processing')
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
  case
    when count(request_id) = 0 then 'failed'
    when count(request_id) filter (where scored) = count(request_id)
      then 'completed'
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
