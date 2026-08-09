-- fps is computed by the worker (ffprobe) and used throughout frame
-- sampling/OCR timing, but was never persisted -- add it alongside the
-- other probe-derived fields on video_metadata.
alter table public.video_metadata
  add column fps numeric;
