-- Tracks the worker's own Media Processing stage on `requests`, mirroring
-- evaluation_completion_status, so the UI can read pipeline state from one
-- row instead of joining video_processing (which stays empty when a request
-- never gets past preprocessing).
alter table public.requests
  add column media_processing_status text,
  add column media_processing_error text,
  add constraint requests_media_processing_status_check
    check (
      media_processing_status is null
      or media_processing_status in ('pending', 'processing', 'completed', 'failed')
    );
