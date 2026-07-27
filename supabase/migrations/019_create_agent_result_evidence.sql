create table public.agent_result_evidence (
  request_id uuid not null,
  agent text not null,
  metric_id text not null,
  evidence_order integer not null,
  evidence_type text not null,
  evidence_text text not null,
  evidence_timestamp text not null default '',
  primary key (request_id, agent, metric_id, evidence_order),
  foreign key (request_id, agent, metric_id)
    references public.agent_results(request_id, agent, metric_id)
    on delete cascade
);

alter table public.agent_result_evidence enable row level security;
