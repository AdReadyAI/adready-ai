-- Migration 048 was replaced after its original score-queue version had
-- already reached hosted databases. Reconcile both migration histories under
-- a new version so Railway receives only Media Processing messages.
drop trigger if exists trg_enqueue_score_job_on_agent_results
  on public.agent_results;
drop function if exists public.enqueue_score_job_for_request();

alter table public.requests
  add column if not exists evaluation_completion_status text,
  add column if not exists evaluation_completion_attempts integer
    not null default 0,
  add column if not exists evaluation_completion_started_at timestamptz,
  add column if not exists evaluation_completion_completed_at timestamptz,
  add column if not exists evaluation_completion_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.requests'::regclass
      and conname = 'requests_evaluation_completion_status_check'
  ) then
    alter table public.requests
      add constraint requests_evaluation_completion_status_check
      check (
        evaluation_completion_status is null
        or evaluation_completion_status in (
          'pending', 'processing', 'completed', 'failed'
        )
      );
  end if;
end;
$$;

create or replace function public.trigger_evaluation_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_batch_id uuid;
  completion_status text;
  metric_count integer;
  base_url text;
  trigger_secret text;
begin
  -- Only canonical evaluator output contributes to the Score Engine input.
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

  -- Serialize scheduling per Ad Creative so a multi-row evaluator write can
  -- request completion only once.
  select requests.batch_id, requests.evaluation_completion_status
  into request_batch_id, completion_status
  from public.requests
  where requests.request_id = new.request_id
  for update;

  if request_batch_id is null then
    raise exception 'request not found: %', new.request_id;
  end if;

  select count(*) into metric_count
  from (
    select distinct agent, metric_id
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
      )
  ) canonical_metrics;

  if metric_count <> 10 or completion_status = 'pending' then
    return new;
  end if;

  update public.requests
  set evaluation_completion_status = 'pending',
      evaluation_completion_last_error = null,
      evaluation_completion_completed_at = null
  where request_id = new.request_id;

  begin
    select decrypted_secret into base_url
    from vault.decrypted_secrets
    where name = 'edge_functions_base_url';

    select decrypted_secret into trigger_secret
    from vault.decrypted_secrets
    where name = 'internal_trigger_secret';

    if base_url is null or trigger_secret is null then
      raise exception 'evaluation completion secrets are not configured';
    end if;

    perform net.http_post(
      url := base_url || '/complete-evaluation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || trigger_secret
      ),
      body := jsonb_build_object(
        'request_id', new.request_id,
        'batch_id', request_batch_id
      )
    );
  exception when others then
    -- Scheduling failures remain visible without rolling back evaluator data.
    update public.requests
    set evaluation_completion_status = 'failed',
        evaluation_completion_last_error = sqlerrm
    where request_id = new.request_id;
  end;

  return new;
end;
$$;

drop trigger if exists trg_trigger_evaluation_completion
  on public.agent_results;
create trigger trg_trigger_evaluation_completion
  after insert or update on public.agent_results
  for each row
  execute function public.trigger_evaluation_completion();

create or replace function public.mark_evaluation_completion_started(
  p_request_id uuid,
  p_batch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.requests
  set evaluation_completion_status = 'processing',
      evaluation_completion_attempts = evaluation_completion_attempts + 1,
      evaluation_completion_started_at = now(),
      evaluation_completion_last_error = null
  where request_id = p_request_id
    and batch_id = p_batch_id;

  return found;
end;
$$;

create or replace function public.mark_evaluation_completion_finished(
  p_request_id uuid,
  p_batch_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid evaluation completion status: %', p_status;
  end if;

  update public.requests
  set evaluation_completion_status = p_status,
      evaluation_completion_completed_at = case
        when p_status = 'completed' then now()
        else null
      end,
      evaluation_completion_last_error = case
        when p_status = 'failed' then p_error
        else null
      end
  where request_id = p_request_id
    and batch_id = p_batch_id;

  return found;
end;
$$;

revoke all on function public.mark_evaluation_completion_started(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_evaluation_completion_finished(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.mark_evaluation_completion_started(uuid, uuid)
  to service_role;
grant execute on function public.mark_evaluation_completion_finished(
  uuid, uuid, text, text
) to service_role;
