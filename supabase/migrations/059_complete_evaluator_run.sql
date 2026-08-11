-- Complete one Evaluator Run and replace its normalized output in the same
-- transaction. This prevents lifecycle state from disagreeing with the rows
-- consumed by evaluation completion and the Score Engine.
create or replace function public.complete_evaluator_run(
  p_request_id uuid,
  p_evaluator text,
  p_results jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  expected_metric_ids text[];
  supplied_metric_ids text[];
begin
  select status
  into current_status
  from public.evaluator_runs
  where request_id = p_request_id
    and evaluator = p_evaluator
  for update;

  if current_status is null then
    return false;
  end if;

  -- A repeated completion after an HTTP response was lost is already done.
  if current_status = 'completed' then
    return true;
  end if;

  if current_status <> 'processing' then
    raise exception 'Evaluator Run must be processing before completion';
  end if;

  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Evaluator results must be a JSON array';
  end if;

  expected_metric_ids := case p_evaluator
    when 'claims_accuracy'
      then array['policy_compliance', 'product_truth']
    when 'storyline_clarity'
      then array['channel_readiness', 'creative_effectiveness']
    when 'cta_effectiveness'
      then array['cta_clarity']
    when 'product_representation'
      then array['product_clarity']
    when 'visual_quality'
      then array['production_readiness']
    when 'brand_alignment'
      then array['brand_fit']
    when 'brief_alignment'
      then array['audience_fit', 'brief_adherence']
    else null
  end;

  if expected_metric_ids is null then
    raise exception 'Unknown evaluator: %', p_evaluator;
  end if;

  -- Sorting makes exact-set comparison independent of evaluator output order.
  select coalesce(array_agg(metric_id order by metric_id), '{}'::text[])
  into supplied_metric_ids
  from (
    select result->>'metric_id' as metric_id
    from jsonb_array_elements(p_results) as result
    where result->>'agent' = p_evaluator
      and nullif(result->>'metric_id', '') is not null
  ) supplied;

  if supplied_metric_ids <> expected_metric_ids then
    raise exception 'Evaluator % returned an incomplete or invalid metric set',
      p_evaluator;
  end if;

  -- The existing writer atomically replaces metrics and their evidence and
  -- sub-check children. It runs inside this function's transaction.
  perform public.replace_agent_metric_results(p_request_id, p_results);

  update public.evaluator_runs
  set status = 'completed',
      completed_at = now(),
      last_error_code = null,
      last_error = null,
      updated_at = now()
  where request_id = p_request_id
    and evaluator = p_evaluator
    and status = 'processing';

  if not found then
    raise exception 'Evaluator Run changed state during completion';
  end if;

  return true;
end;
$$;

revoke all on function public.complete_evaluator_run(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_evaluator_run(uuid, text, jsonb)
  to service_role;
