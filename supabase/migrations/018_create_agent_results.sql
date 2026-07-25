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

grant usage on schema public to service_role;
grant select on public.parsed_creative_briefs, public.product_context,
  public.video_metadata, public.ocr_segments,
  public.visual_frames, public.product_frames, public.logo_frames
  to service_role;
grant select, insert, update, delete on public.agent_results,
  public.agent_result_evidence, public.agent_result_sub_checks
  to service_role;
