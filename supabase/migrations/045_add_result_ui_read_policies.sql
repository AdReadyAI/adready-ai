-- Authenticated users may read the Result UI tables only for requests they own.
-- Same ownership predicate and shape as 027_add_agent_result_read_policies.sql,
-- which did this for agent_results and its child tables.
--
-- Why this migration exists: 025 (issues) and 026 (result_score_*) both end with
-- ENABLE ROW LEVEL SECURITY and ship zero policies -- 026 says so outright
-- ("Product auth policies TBD"). RLS with no policy denies every read, and
-- PostgREST reports that denial as an empty array rather than an error, so the
-- Result UI would render "no data" with nothing in the console to explain it.
-- 042_grant_on_issues_to_service_role.sql (on the issues-edge-function branch)
-- covers the write path only; nothing has granted read access to end users.

grant select on table
  public.issues,
  public.result_score_table,
  public.result_score_dimensions
to authenticated;

create policy "users read own issues"
  on public.issues
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = issues.request_id
        and requests.user_id = auth.uid()
    )
  );

create policy "users read own result scores"
  on public.result_score_table
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests
      where requests.request_id = result_score_table.request_id
        and requests.user_id = auth.uid()
    )
  );

-- Two hops, unlike the two policies above. result_score_dimensions has no
-- batch_id and its foreign key points at result_score_table, not requests, so
-- ownership has to be proven through the parent score row. Writing this as a
-- one-hop join against requests would match nothing and fail closed: empty
-- metric bars, no error.
create policy "users read own result score dimensions"
  on public.result_score_dimensions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.result_score_table
      join public.requests
        on requests.request_id = result_score_table.request_id
      where result_score_table.request_id = result_score_dimensions.request_id
        and requests.user_id = auth.uid()
    )
  );
