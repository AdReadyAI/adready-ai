-- The pipeline's expected work, declared up front. Without this the UI can
-- only show tasks that already have rows, which is why the current loading
-- screen sits on "Waiting for processing to start…" through all of
-- preprocessing. Declaring the list gives the checklist a real denominator
-- from t=0.
--
-- These are reference data, not user data — safe to expose wholesale.

create table public.pipeline_tasks (
  task_name    text primary key,
  display_name text not null,
  sort_order   int  not null,
  weight       int  not null default 1
);

-- Task names must match worker/analyzer/video_analyzer.py's @analysis_task
-- decorators and the CHECK constraint in 031_rename_object_detection_tasks.sql.
insert into public.pipeline_tasks (task_name, display_name, sort_order, weight) values
  ('transcription',     'Transcription',     1, 1),
  ('ocr',               'On-screen text',    2, 1),
  ('product_detection', 'Product detection', 3, 1),
  ('logo_detection',    'Logo detection',    4, 1),
  ('context',           'Visual context',    5, 1);

create table public.pipeline_agents (
  agent_key    text primary key,
  display_name text not null,
  sort_order   int  not null,
  weight       int  not null default 1
);

-- Agent keys are the snake_case identifiers written into agent_results.agent
-- (see the documented payload in claims-agent/index.ts and the dimension_id
-- CHECK in 026_create_result_score_table.sql) — NOT the kebab-case Edge
-- Function directory names.
insert into public.pipeline_agents (agent_key, display_name, sort_order, weight) values
  ('claims_accuracy',        'Claim accuracy',         1, 1),
  ('storyline_brief',        'Storyline & brief',      2, 1),
  ('product_representation', 'Product representation', 3, 1),
  ('brand_alignment',        'Brand alignment',        4, 1),
  ('cta_effectiveness',      'CTA effectiveness',      5, 1),
  ('visual_asset_quality',   'Visual quality',         6, 1);

grant select on public.pipeline_tasks  to authenticated;
grant select on public.pipeline_agents to authenticated;

-- ⚠️ SECURITY: this is a definer view — it runs with the view owner's rights
-- and therefore BYPASSES row level security on the tables it reads. That is
-- deliberate: it lets us expose an aggregate to the browser while
-- video_processing itself stays service_role-only.
--
-- The consequence is that `where r.user_id = auth.uid()` is the ONLY thing
-- standing between a user and everyone else's data, and it must appear in
-- EVERY union branch. A missing filter in one branch leaks that branch.
-- There is a required test for this in §5.

create or replace view public.request_pipeline_progress as

-- ---- stage 1: preprocessing -------------------------------------------
-- prepare() writes video_metadata before _run_analysis() starts, so that row
-- is the completion signal. The OR guard is defensive: persist_video_metadata
-- is wrapped in try/except in processor.py and only logs on failure, so the
-- row can be missing from a job that actually progressed fine. Analysis rows
-- can only exist if preprocessing finished, so their presence proves it too.
select
  r.request_id,
  r.batch_id,
  'preprocessing'::text  as stage_key,
  1                      as stage_order,
  'preprocessing'::text  as unit_key,
  'Preparing video'::text as display_name,
  1                      as sort_order,
  5                      as weight,
  case
    when vm.request_id is not null
      or exists (select 1 from public.video_processing v where v.request_id = r.request_id)
    then 'success'
    else 'processing'
  end as status
from public.requests r
left join public.video_metadata vm on vm.request_id = r.request_id
where r.user_id = auth.uid()

union all

-- ---- stage 2: analysis ------------------------------------------------
-- cross join produces every expected task for every request, so the
-- denominator is correct before the worker has written anything. Missing row
-- => 'queued'.
select
  r.request_id,
  r.batch_id,
  'analysis'::text as stage_key,
  2                as stage_order,
  pt.task_name     as unit_key,
  pt.display_name,
  pt.sort_order,
  pt.weight,
  coalesce(vp.status, 'queued') as status
from public.requests r
cross join public.pipeline_tasks pt
left join public.video_processing vp
       on vp.request_id = r.request_id
      and vp.task_name  = pt.task_name
where r.user_id = auth.uid()

union all

-- ---- stage 3: evaluation ----------------------------------------------
-- An agent counts as done once it has written ANY metric row for this
-- request. agent_results is PK (request_id, agent, metric_id), and
-- replace_agent_metric_results (030) writes all of one agent's metrics in a
-- single transaction — so a partially-written agent is never observable.
-- Presence of one row therefore means that agent finished.
--
-- Note this is a row-count check, not a status check: agent_results has no
-- status column. An agent that ran and found nothing wrong still writes rows
-- (result/severity carry the verdict), so "no rows" unambiguously means
-- "hasn't run yet".
select
  r.request_id,
  r.batch_id,
  'evaluation'::text as stage_key,
  3                  as stage_order,
  pa.agent_key       as unit_key,
  pa.display_name,
  pa.sort_order,
  pa.weight,
  case when count(ar.metric_id) > 0 then 'success' else 'queued' end as status
from public.requests r
cross join public.pipeline_agents pa
left join public.agent_results ar
       on ar.request_id = r.request_id
      and ar.agent      = pa.agent_key
where r.user_id = auth.uid()
group by r.request_id, r.batch_id, pa.agent_key, pa.display_name,
         pa.sort_order, pa.weight

union all

-- ---- stage 4: scoring -------------------------------------------------
-- result_score_table is PK request_id — exactly one row per request, written
-- last by the score bridge. Its presence is the end-to-end completion signal
-- and is what gates the transition to the results view (D11).
select
  r.request_id,
  r.batch_id,
  'scoring'::text          as stage_key,
  4                        as stage_order,
  'scoring'::text          as unit_key,
  'Calculating score'::text as display_name,
  1                        as sort_order,
  1                        as weight,
  case when rs.request_id is not null then 'success' else 'queued' end as status
from public.requests r
left join public.result_score_table rs on rs.request_id = r.request_id
where r.user_id = auth.uid();

grant select on public.request_pipeline_progress to authenticated;

-- Why stages 3–4 need no new grants: agent_results has authenticated read
-- policies (027), but result_score_table has none — 026's comment says
-- "Product auth policies TBD. Until then, only service_role bypasses RLS."
-- That doesn't matter here: the definer view bypasses RLS on everything it
-- reads, and `where r.user_id = auth.uid()` is what scopes the result. So
-- this migration adds zero grants on pipeline tables. Same property that
-- keeps video_processing private.

create or replace view public.request_progress as
select
  request_id,
  batch_id,
  sum(weight)                                             as total_weight,
  sum(weight) filter (where status in ('success','error')) as done_weight,
  round(
    100.0 * sum(weight) filter (where status in ('success','error'))
    / nullif(sum(weight), 0)
  )::int                                                  as progress_pct,
  count(*) filter (where status = 'error')                as failed_units,
  bool_and(status in ('success','error'))                 as is_complete
from public.request_pipeline_progress
group by request_id, batch_id;

grant select on public.request_progress to authenticated;

-- Expected CI noise: `supabase db lint` will flag rule
-- 0010_security_definer_view on both views above. CI runs
-- `--level warning --fail-on error`, so this reports but does not fail.
-- Do NOT "fix" it by switching to security_invoker — that would apply RLS
-- as the caller, and video_processing has RLS enabled with no authenticated
-- policy, so every status would read 'queued' forever.
