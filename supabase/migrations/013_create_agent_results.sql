create table public.agent_results (
  request_id uuid not null references public.requests(request_id) on delete cascade,
  video_id uuid not null references public.request_videos(video_id) on delete cascade,
  results jsonb not null default '[]'::jsonb,
  primary key (request_id, video_id)
);

grant usage on schema public to service_role;
grant select on public.requests, public.request_videos, public.video_processing,
  public.transcript_segments, public.parsed_creative_briefs,
  public.product_context, public.video_metadata, public.ocr_segments,
  public.visual_frames, public.product_frames, public.logo_frames
  to service_role;
grant select, insert, update on public.agent_results to service_role;
