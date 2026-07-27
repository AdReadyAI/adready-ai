create table public.agent_results (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  agent text not null,
  metric_id text not null,
  metric_name text not null,
  result text not null,
  severity text not null,
  confidence text,
  explanation text,
  suggested_correction text,
  correction_type text,
  primary key (request_id, agent, metric_id)
);

alter table public.agent_results enable row level security;
