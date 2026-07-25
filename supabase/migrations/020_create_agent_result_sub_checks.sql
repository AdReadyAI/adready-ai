create table public.agent_result_sub_checks (
  request_id uuid not null,
  agent text not null,
  metric_id text not null,
  check_id text not null,
  name text not null,
  result text not null,
  severity text not null,
  explanation text,
  primary key (request_id, agent, metric_id, check_id),
  foreign key (request_id, agent, metric_id)
    references public.agent_results(request_id, agent, metric_id)
    on delete cascade
);

alter table public.agent_result_sub_checks enable row level security;

grant select, insert, update, delete on public.agent_result_sub_checks to service_role;
