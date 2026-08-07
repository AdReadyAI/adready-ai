-- Enqueue a score job when all atomic evaluator output lands for a request.
-- This preserves the trigger-based orchestration for the score-result and
-- process-issues workflow while keeping the queue contract simple.
drop function if exists public.enqueue_score_job_for_request(uuid);
drop function if exists public.enqueue_score_job_for_request();

create or replace function public.enqueue_score_job_for_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_batch_id uuid;
  metric_count int;
  job_payload jsonb;
begin
  -- Ignore future or unrelated evaluator metrics. They do not change the
  -- canonical Score Engine input and therefore must not enqueue another job.
  if (new.agent, new.metric_id) not in (
    ('brief_alignment', 'brief_adherence'),
    ('claims_accuracy', 'product_truth'),
    ('product_representation', 'product_clarity'),
    ('brief_alignment', 'audience_fit'),
    ('storyline_clarity', 'channel_readiness'),
    ('brand_alignment', 'brand_fit'),
    ('cta_effectiveness', 'cta_clarity'),
    ('storyline_clarity', 'creative_effectiveness'),
    ('visual_quality', 'production_readiness'),
    ('claims_accuracy', 'policy_compliance')
  ) then
    return new;
  end if;

  select requests.batch_id into request_batch_id
  from public.requests
  where requests.request_id = new.request_id;

  if request_batch_id is null then
    raise exception 'request not found: %', new.request_id;
  end if;

  select count(distinct metric_id) into metric_count
  from public.agent_results
  where request_id = new.request_id
    and (agent, metric_id) in (
      ('brief_alignment', 'brief_adherence'),
      ('claims_accuracy', 'product_truth'),
      ('product_representation', 'product_clarity'),
      ('brief_alignment', 'audience_fit'),
      ('storyline_clarity', 'channel_readiness'),
      ('brand_alignment', 'brand_fit'),
      ('cta_effectiveness', 'cta_clarity'),
      ('storyline_clarity', 'creative_effectiveness'),
      ('visual_quality', 'production_readiness'),
      ('claims_accuracy', 'policy_compliance')
    );

  if metric_count = 10 then
    job_payload := jsonb_build_object(
      'job_type', 'score',
      'request_id', new.request_id,
      'batch_id', request_batch_id
    );

    perform pgmq.send('jobs', job_payload);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_score_job_on_agent_results on public.agent_results;
drop trigger if exists trg_enqueue_score_job_on_sub_checks
  on public.agent_result_sub_checks;
drop trigger if exists trg_enqueue_score_job_on_evidence
  on public.agent_result_evidence;

create trigger trg_enqueue_score_job_on_agent_results
  after insert or update on public.agent_results
  for each row
  execute function public.enqueue_score_job_for_request();
