-- Replace one evaluator invocation's normalized results atomically. Keeping the
-- parent metrics, evidence, and sub-checks in one database transaction prevents
-- the score engine from observing a partially replaced evaluator result set.
create or replace function public.replace_agent_metric_results(
  p_request_id uuid,
  p_results jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  metric jsonb;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Evaluator results must be a JSON array';
  end if;

  -- Process each validated metric inside this function's implicit transaction,
  -- so any parent or child write failure rolls back the complete invocation.
  for metric in
    select value
    from jsonb_array_elements(p_results)
  loop
    insert into public.agent_results (
      request_id,
      agent,
      metric_id,
      metric_name,
      result,
      severity,
      confidence,
      explanation,
      suggested_correction,
      correction_type
    )
    values (
      p_request_id,
      metric->>'agent',
      metric->>'metric_id',
      metric->>'metric_name',
      metric->>'result',
      metric->>'severity',
      metric->>'confidence',
      metric->>'explanation',
      metric->>'suggested_correction',
      metric->>'correction_type'
    )
    on conflict (request_id, agent, metric_id) do update
    set
      metric_name = excluded.metric_name,
      result = excluded.result,
      severity = excluded.severity,
      confidence = excluded.confidence,
      explanation = excluded.explanation,
      suggested_correction = excluded.suggested_correction,
      correction_type = excluded.correction_type;

    -- Child rows are a complete replacement for the metric. Deleting them
    -- before reinsertion also removes evidence omitted by a later evaluation.
    delete from public.agent_result_evidence
    where request_id = p_request_id
      and agent = metric->>'agent'
      and metric_id = metric->>'metric_id';

    delete from public.agent_result_sub_checks
    where request_id = p_request_id
      and agent = metric->>'agent'
      and metric_id = metric->>'metric_id';

    insert into public.agent_result_evidence (
      request_id,
      agent,
      metric_id,
      evidence_order,
      evidence_type,
      evidence_text,
      evidence_timestamp
    )
    select
      p_request_id,
      metric->>'agent',
      metric->>'metric_id',
      evidence_order - 1,
      evidence->>'type',
      evidence->>'text',
      coalesce(evidence->>'timestamp', '')
    from jsonb_array_elements(coalesce(metric->'evidence', '[]'::jsonb))
      with ordinality as evidence_rows(evidence, evidence_order);

    insert into public.agent_result_sub_checks (
      request_id,
      agent,
      metric_id,
      check_id,
      name,
      result,
      severity,
      explanation
    )
    select
      p_request_id,
      metric->>'agent',
      metric->>'metric_id',
      sub_check->>'check_id',
      sub_check->>'name',
      sub_check->>'result',
      sub_check->>'severity',
      sub_check->>'explanation'
    from jsonb_array_elements(coalesce(metric->'sub_checks', '[]'::jsonb))
      as sub_check_rows(sub_check);
  end loop;
end;
$$;

-- Evaluator Edge Functions use the service key. Browser roles must not invoke
-- this mutation directly, even though authenticated users can read the result.
revoke all on function public.replace_agent_metric_results(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_agent_metric_results(uuid, jsonb)
  to service_role;
