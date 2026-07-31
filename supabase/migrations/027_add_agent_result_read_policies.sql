-- Authenticated users may read only normalized agent output for requests they
-- own. The same ownership predicate is applied to the parent and both child
-- tables so the frontend can query result details directly.

grant select on table
  public.agent_results,
  public.agent_result_evidence,
  public.agent_result_sub_checks
to authenticated;

create policy "users read own agent results"
  on public.agent_results
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = agent_results.request_id
        and requests.user_id = auth.uid()
    )
  );

create policy "users read own agent result evidence"
  on public.agent_result_evidence
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = agent_result_evidence.request_id
        and requests.user_id = auth.uid()
    )
  );

create policy "users read own agent result sub checks"
  on public.agent_result_sub_checks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = agent_result_sub_checks.request_id
        and requests.user_id = auth.uid()
    )
  );
