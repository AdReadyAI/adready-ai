begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id)
values ('00000000-0000-0000-0000-000000000010');

insert into public.requests (
  request_id,
  user_id,
  batch_id,
  video_storage_paths
)
values (
  '10000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000010',
  '20000000-0000-0000-0000-000000000010',
  array['evaluator-run.mp4']
);

insert into public.evaluator_runs (request_id, evaluator, status)
values (
  '10000000-0000-0000-0000-000000000010',
  'cta_effectiveness',
  'dispatched'
);

select ok(
  public.mark_evaluator_run_started(
    '10000000-0000-0000-0000-000000000010',
    'cta_effectiveness'
  ),
  'a dispatched Evaluator Run can be claimed'
);

select is(
  (
    select status
    from public.evaluator_runs
    where request_id = '10000000-0000-0000-0000-000000000010'
      and evaluator = 'cta_effectiveness'
  ),
  'processing',
  'claiming marks the Evaluator Run processing'
);

select is(
  (
    select attempt_count
    from public.evaluator_runs
    where request_id = '10000000-0000-0000-0000-000000000010'
      and evaluator = 'cta_effectiveness'
  ),
  1,
  'claiming increments the attempt count'
);

select ok(
  public.complete_evaluator_run(
    '10000000-0000-0000-0000-000000000010',
    'cta_effectiveness',
    jsonb_build_array(
      jsonb_build_object(
        'agent', 'cta_effectiveness',
        'metric_id', 'cta_clarity',
        'metric_name', 'CTA Clarity',
        'result', 'true',
        'severity', 'none'
      )
    )
  ),
  'valid canonical output completes the Evaluator Run'
);

select is(
  (
    select status
    from public.evaluator_runs
    where request_id = '10000000-0000-0000-0000-000000000010'
      and evaluator = 'cta_effectiveness'
  ),
  'completed',
  'completion persists terminal lifecycle state'
);

select is(
  (
    select count(*)::integer
    from public.agent_results
    where request_id = '10000000-0000-0000-0000-000000000010'
      and agent = 'cta_effectiveness'
  ),
  1,
  'completion persists evaluator output in the same transaction'
);

select ok(
  not public.mark_evaluator_run_started(
    '10000000-0000-0000-0000-000000000010',
    'cta_effectiveness'
  ),
  'completed Evaluator Runs cannot be claimed again'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.evaluator_runs',
    'status',
    'select'
  ) and not has_column_privilege(
    'authenticated',
    'public.evaluator_runs',
    'last_error',
    'select'
  ),
  'authenticated users see status but not evaluator diagnostics'
);

insert into public.evaluator_runs (request_id, evaluator, status)
values (
  '10000000-0000-0000-0000-000000000010',
  'visual_quality',
  'processing'
);

select throws_ok(
  $$ select public.complete_evaluator_run(
       '10000000-0000-0000-0000-000000000010',
       'visual_quality',
       '[{
         "agent": "visual_quality",
         "metric_id": "product_truth",
         "metric_name": "Wrong metric",
         "result": "true",
         "severity": "none"
       }]'::jsonb
     ) $$,
  'Evaluator visual_quality returned an incomplete or invalid metric set',
  'completion rejects output that is not the evaluator canonical metric set'
);

select is(
  (
    select status
    from public.evaluator_runs
    where request_id = '10000000-0000-0000-0000-000000000010'
      and evaluator = 'visual_quality'
  ),
  'processing',
  'rejected output leaves the Evaluator Run uncompleted'
);

select ok(
  public.mark_evaluator_run_failed(
    '10000000-0000-0000-0000-000000000010',
    'visual_quality',
    'ProviderError',
    null
  ),
  'a processing Evaluator Run can persist a sanitized failure'
);

insert into public.evaluator_runs (
  request_id,
  evaluator,
  status,
  updated_at
)
values (
  '10000000-0000-0000-0000-000000000010',
  'brand_alignment',
  'dispatched',
  now() - interval '11 minutes'
);

select is(
  public.reconcile_stale_evaluator_runs(now() - interval '10 minutes'),
  1,
  'reconciliation finds one stale nonterminal Evaluator Run'
);

select is(
  (
    select status
    from public.evaluator_runs
    where request_id = '10000000-0000-0000-0000-000000000010'
      and evaluator = 'brand_alignment'
  ),
  'timed_out',
  'reconciliation makes a hard evaluator timeout terminal and visible'
);

delete from public.requests
where request_id = '10000000-0000-0000-0000-000000000010';

select is_empty(
  $$ select * from public.evaluator_runs
     where request_id = '10000000-0000-0000-0000-000000000010' $$,
  'deleting the Ad Creative cascades through its Evaluator Runs'
);

select * from finish();
rollback;
