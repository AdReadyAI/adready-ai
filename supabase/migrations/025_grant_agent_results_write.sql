-- Grants so Edge Functions (service_role) can persist MetricResult rows.
-- Tables already exist (018-020); RLS is enabled and service_role bypasses it
-- once INSERT/UPDATE/DELETE/SELECT are granted.

grant select, insert, update, delete on public.agent_results to service_role;
grant select, insert, update, delete on public.agent_result_evidence to service_role;
grant select, insert, update, delete on public.agent_result_sub_checks to service_role;

-- Optional: allow authenticated clients to read their own results later.
grant select on public.agent_results to authenticated;
grant select on public.agent_result_evidence to authenticated;
grant select on public.agent_result_sub_checks to authenticated;
