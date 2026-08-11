-- Persist one lifecycle row for every evaluator expected to review an Ad
-- Creative. Evaluator output remains in agent_results; this table records the
-- work that should produce that output, including failures and retries.
create table public.evaluator_runs (
  request_id uuid not null
    references public.requests(request_id) on delete cascade,
  evaluator text not null
    check (
      evaluator in (
        'claims_accuracy',
        'storyline_clarity',
        'cta_effectiveness',
        'product_representation',
        'visual_quality',
        'brand_alignment',
        'brief_alignment'
      )
    ),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'dispatched',
        'processing',
        'completed',
        'dispatch_failed',
        'failed',
        'timed_out'
      )
    ),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  dispatch_request_id bigint,
  dispatched_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text
    check (last_error_code is null or length(last_error_code) <= 100),
  last_error text
    check (last_error is null or length(last_error) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (request_id, evaluator)
);

create index evaluator_runs_status_updated_at_idx
  on public.evaluator_runs (status, updated_at);

alter table public.evaluator_runs enable row level security;

-- Authenticated progress polling receives lifecycle state, never internal
-- diagnostics or pg_net identifiers.
grant select (request_id, evaluator, status)
  on public.evaluator_runs to authenticated;

create policy "users read own evaluator run status"
  on public.evaluator_runs for select to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = evaluator_runs.request_id
        and requests.user_id = auth.uid()
    )
  );

grant select, insert, update on public.evaluator_runs to service_role;

-- Claim one dispatched Evaluator Run immediately before evaluator work begins.
-- A failed or timed-out run may be retried; completed work remains idempotent.
create or replace function public.mark_evaluator_run_started(
  p_request_id uuid,
  p_evaluator text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.evaluator_runs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      started_at = now(),
      completed_at = null,
      last_error_code = null,
      last_error = null,
      updated_at = now()
  where request_id = p_request_id
    and evaluator = p_evaluator
    and status in ('dispatched', 'failed', 'timed_out');

  return found;
end;
$$;

-- Persist only bounded operational diagnostics. Callers are responsible for
-- supplying sanitized values that contain no prompts, evidence, or PII.
create or replace function public.mark_evaluator_run_failed(
  p_request_id uuid,
  p_evaluator text,
  p_error_code text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.evaluator_runs
  set status = 'failed',
      completed_at = now(),
      last_error_code = left(p_error_code, 100),
      last_error = case when p_error is null then null else left(p_error, 1000) end,
      updated_at = now()
  where request_id = p_request_id
    and evaluator = p_evaluator
    and status = 'processing';

  return found;
end;
$$;

revoke all on function public.mark_evaluator_run_started(uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_evaluator_run_failed(
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.mark_evaluator_run_started(uuid, text)
  to service_role;
grant execute on function public.mark_evaluator_run_failed(
  uuid, text, text, text
) to service_role;

-- Plan all seven Evaluator Runs before dispatching any of them. The endpoint
-- names are transport details; evaluator names match agent_results.agent.
create or replace function public.trigger_run_agents_on_processing_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  already_triggered timestamptz;
  base_url text;
  trigger_secret text;
  evaluator_record record;
  dispatch_id bigint;
begin
  select agents_triggered_at into already_triggered
  from public.requests
  where request_id = new.request_id
  for update;

  if already_triggered is not null then
    return new;
  end if;

  if not public.video_processing_all_done(new.request_id) then
    return new;
  end if;

  -- Materialize the complete plan first so absence is never used as a status.
  insert into public.evaluator_runs (request_id, evaluator)
  select new.request_id, evaluator
  from unnest(array[
    'claims_accuracy',
    'storyline_clarity',
    'cta_effectiveness',
    'product_representation',
    'visual_quality',
    'brand_alignment',
    'brief_alignment'
  ]) as evaluator
  on conflict (request_id, evaluator) do nothing;

  update public.requests
  set agents_triggered_at = now()
  where request_id = new.request_id;

  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'edge_functions_base_url';
  select decrypted_secret into trigger_secret
  from vault.decrypted_secrets where name = 'internal_trigger_secret';

  for evaluator_record in
    select *
    from (
      values
        ('claims_accuracy', 'claims-agent'),
        ('storyline_clarity', 'storyline-clarity-agent'),
        ('cta_effectiveness', 'cta-effectiveness-agent'),
        ('product_representation', 'product-representation-agent'),
        ('visual_quality', 'visual-quality-agent'),
        ('brand_alignment', 'brand-alignment-agent'),
        ('brief_alignment', 'brief-alignment-agent')
    ) as evaluators(evaluator, endpoint)
  loop
    begin
      if base_url is null or trigger_secret is null then
        raise exception 'evaluator dispatch secrets are not configured';
      end if;

      dispatch_id := net.http_post(
        url := base_url || '/' || evaluator_record.endpoint,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || trigger_secret
        ),
        body := jsonb_build_object('request_id', new.request_id)
      );

      update public.evaluator_runs
      set status = 'dispatched',
          dispatch_request_id = dispatch_id,
          dispatched_at = now(),
          completed_at = null,
          last_error_code = null,
          last_error = null,
          updated_at = now()
      where request_id = new.request_id
        and evaluator = evaluator_record.evaluator;
    exception when others then
      -- A failure for one evaluator must not hide or roll back the other six.
      update public.evaluator_runs
      set status = 'dispatch_failed',
          completed_at = now(),
          last_error_code = 'dispatch_failed',
          last_error = left(sqlerrm, 1000),
          updated_at = now()
      where request_id = new.request_id
        and evaluator = evaluator_record.evaluator;
    end;
  end loop;

  return new;
end;
$$;
