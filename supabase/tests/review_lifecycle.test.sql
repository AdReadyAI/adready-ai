begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id)
values ('00000000-0000-0000-0000-000000000001');

-- Each request below represents one lifecycle edge the history projection must
-- classify consistently with the live progress screen.
insert into public.requests (request_id, user_id, batch_id, video_storage_paths)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', array['fatal.mp4']),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', array['degraded.mp4']),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', array['failed.mp4']),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', array['running.mp4']),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', array['scored.mp4']),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', array['failed-too.mp4']);

update public.requests
set media_processing_status = 'failed'
where request_id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000006'
);

-- An analyzer error after dispatch is degraded evidence, not Review Failure.
update public.requests
set media_processing_status = 'failed',
    agents_triggered_at = now(),
    evaluation_completion_status = 'completed'
where request_id = '10000000-0000-0000-0000-000000000002';

insert into public.video_processing (request_id, task_name, status, error)
values (
  '10000000-0000-0000-0000-000000000002',
  'transcription',
  'error',
  'internal analyzer detail'
);

update public.requests
set media_processing_status = 'processing'
where request_id = '10000000-0000-0000-0000-000000000004';

update public.requests
set media_processing_status = 'completed',
    agents_triggered_at = now(),
    evaluation_completion_status = 'completed'
where request_id = '10000000-0000-0000-0000-000000000005';

insert into public.result_score_table (
  request_id,
  batch_id,
  config_version,
  ad_readiness_pct,
  readiness_status
)
values
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'test', 80, 'Ready'),
  ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', 'test', 80, 'Ready');

select is(
  (select status from public.review_request_summaries where review_request_id = '20000000-0000-0000-0000-000000000001'),
  'failed',
  'a fatal media failure is terminal without video_processing rows'
);

select is(
  (select status from public.review_request_summaries where review_request_id = '20000000-0000-0000-0000-000000000002'),
  'completed',
  'a scored creative remains completed despite degraded analyzer evidence'
);

select is(
  (select failed_count from public.review_request_summaries where review_request_id = '20000000-0000-0000-0000-000000000002'),
  0,
  'degraded analyzer evidence is not counted as Review Failure'
);

select is(
  (select status from public.review_request_summaries where review_request_id = '20000000-0000-0000-0000-000000000003'),
  'processing',
  'one failed creative does not end a Review Request while another is processing'
);

select is(
  (select status from public.review_request_summaries where review_request_id = '20000000-0000-0000-0000-000000000004'),
  'partially_failed',
  'scored and terminally failed creatives produce a partial failure'
);

select ok(
  not has_column_privilege('authenticated', 'public.requests', 'media_processing_error', 'select'),
  'authenticated users cannot read raw media diagnostics'
);

select ok(
  not has_column_privilege('authenticated', 'public.requests', 'evaluation_completion_last_error', 'select'),
  'authenticated users cannot read raw evaluation diagnostics'
);

select ok(
  has_column_privilege('authenticated', 'public.requests', 'media_processing_failure_code', 'select'),
  'authenticated users can read safe failure categories'
);

select * from finish();
rollback;
