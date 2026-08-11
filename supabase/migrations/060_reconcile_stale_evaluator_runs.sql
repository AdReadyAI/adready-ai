-- Edge runtimes cannot persist failure after a process-level crash. Reconcile
-- stale nonterminal Evaluator Runs in Postgres so they become visible terminal
-- failures instead of leaving Review Requests waiting indefinitely.
create extension if not exists pg_cron;

create or replace function public.reconcile_stale_evaluator_runs(
  p_stale_before timestamptz default now() - interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconciled_count integer;
begin
  update public.evaluator_runs
  set status = 'timed_out',
      completed_at = now(),
      last_error_code = 'evaluator_timeout',
      last_error = null,
      updated_at = now()
  where status in ('pending', 'dispatched', 'processing')
    and updated_at < p_stale_before;

  get diagnostics reconciled_count = row_count;
  return reconciled_count;
end;
$$;

revoke all on function public.reconcile_stale_evaluator_runs(timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_stale_evaluator_runs(timestamptz)
  to service_role;

-- A stable job name makes migration replays update the existing schedule
-- rather than accumulating duplicate reconciliation jobs.
select cron.schedule(
  'reconcile-stale-evaluator-runs',
  '* * * * *',
  $$select public.reconcile_stale_evaluator_runs();$$
);
