alter table public.video_processing
  drop constraint video_processing_task_name_check;

alter table public.video_processing
  add constraint video_processing_task_name_check
  check (task_name in ('transcription', 'ocr', 'product_detection', 'logo_detection', 'context'));
