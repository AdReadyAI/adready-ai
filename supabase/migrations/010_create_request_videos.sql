create table public.request_videos (
  video_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(request_id) on delete cascade,
  storage_path text not null,
  destination_platform text not null default 'unknown',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (request_id, storage_path)
);

alter table public.video_processing
  add column video_id uuid not null references public.request_videos(video_id) on delete cascade;

alter table public.video_processing
  drop constraint if exists video_processing_request_id_task_name_key,
  drop constraint if exists video_processing_task_name_check;

alter table public.video_processing
  add constraint video_processing_task_name_check check (
    task_name in (
      'transcription',
      'ocr',
      'object_detection',
      'visual_analysis',
      'logo_detection',
      'context',
      'brief_parsing'
    )
  ),
  add constraint video_processing_video_task_key unique (video_id, task_name);
