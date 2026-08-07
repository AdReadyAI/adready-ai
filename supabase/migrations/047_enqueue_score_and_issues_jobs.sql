-- Enqueue a single score job when agent evaluation output lands for a request.
-- This preserves the trigger-based orchestration for the score-result and
-- process-issues workflow while keeping the queue contract simple.
drop function if exists public.enqueue_score_job_for_request(uuid);
drop function if exists public.enqueue_score_job_for_request();

create or replace function public.enqueue_score_job_for_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_id uuid;
  metric_count int;
  job_payload jsonb;
begin
  select batch_id into batch_id
  from public.requests
  where request_id = new.request_id;

  if batch_id is null then
    raise exception 'request not found: %', new.request_id;
  end if;

  select count(distinct metric_id) into metric_count
  from public.agent_results
  where request_id = new.request_id
    and metric_id in (
      'brief_adherence',
      'product_truth',
      'product_clarity',
      'audience_channel_fit',
      'brand_fit',
      'cta_clarity',
      'creative_effectiveness',
      'production_readiness',
      'policy_compliance'
    );

  if metric_count = 9 then
    job_payload := jsonb_build_object(
      'job_type', 'score',
      'request_id', new.request_id,
      'batch_id', batch_id
    );

    perform pgmq.send('jobs', job_payload);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_score_job_on_agent_results on public.agent_results;
drop trigger if exists trg_enqueue_score_job_on_sub_checks on public.agent_result_sub_checks;
drop trigger if exists trg_enqueue_score_job_on_evidence on public.agent_result_evidence;

create trigger trg_enqueue_score_job_on_agent_results
  after insert or update on public.agent_results
  for each row
  execute function public.enqueue_score_job_for_request();

create trigger trg_enqueue_score_job_on_sub_checks
  after insert or update on public.agent_result_sub_checks
  for each row
  execute function public.enqueue_score_job_for_request();

create trigger trg_enqueue_score_job_on_evidence
  after insert or update on public.agent_result_evidence
  for each row
  execute function public.enqueue_score_job_for_request();
