alter table public.visual_frames
  drop constraint visual_frames_pkey,
  drop column request_id,
  drop column visual_description,
  drop column camera_movement,
  add column processing_id uuid not null references public.video_processing(id) on delete cascade,
  add column action text not null,
  add column framing_composition text,
  add column shot_index integer,
  add column is_shot_start boolean not null default false,
  add column is_fade boolean not null default false;

create index idx_visual_frames_processing_id on public.visual_frames (processing_id);
