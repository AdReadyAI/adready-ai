-- Product Context extraction now reads the URL from the job payload instead
-- of querying `requests` at processing time, so it must be enqueued too.
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
      'logo_paths', new.logo_paths,
      'product_url', new.product_url
    )
  );
  return new;
end;
$$;
