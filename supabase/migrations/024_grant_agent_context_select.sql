-- Agent context tables were created with RLS policies but without SELECT
-- grants for service_role / authenticated. Without these grants, Edge
-- Functions cannot load AgentContext by request_id (permission denied).
-- service_role bypasses RLS once SELECT is granted.

grant select on public.requests to authenticated, service_role;
grant select on public.parsed_creative_briefs to authenticated, service_role;
grant select on public.product_context to authenticated, service_role;
grant select on public.video_metadata to authenticated, service_role;
grant select on public.ocr_segments to authenticated, service_role;
grant select on public.visual_frames to authenticated, service_role;
grant select on public.product_frames to authenticated, service_role;
grant select on public.logo_frames to authenticated, service_role;
grant select on public.video_processing to authenticated, service_role;
grant select on public.transcript_segments to authenticated, service_role;
