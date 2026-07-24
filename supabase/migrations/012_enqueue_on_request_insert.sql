-- Nothing currently calls enqueue_job() when a `requests` row lands, so a
-- submitted request just sits there and the worker is never notified. One
-- `requests` row is one video (see 011_add_batch_id.sql's fan-out model),
-- which maps directly onto one JobPayload / one enqueue_job() call, so this
-- fires automatically on insert instead of requiring the app to call it.
--
-- AFTER INSERT trigger runs inside the same transaction as the INSERT, so a
-- failed enqueue (e.g. pgmq unavailable) rolls back the request insert too.

create or replace function public.enqueue_job_on_request_insert()
returns trigger
language plpgsql
as $$
begin
  perform enqueue_job(
    jsonb_build_object(
      'request_id', new.request_id,
      'bucket', 'uploads',
      'video_path', new.video_storage_paths[1],
      'product_image_paths', new.product_image_paths,
      'logo_paths', new.logo_paths
    )
  );
  return new;
end;
$$;

create trigger trg_enqueue_job_on_request_insert
  after insert on public.requests
  for each row
  execute function public.enqueue_job_on_request_insert();
