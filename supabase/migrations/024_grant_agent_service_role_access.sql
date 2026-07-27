-- Grant the service_role the necessary privileges to access the required tables.

grant select on table
  public.requests,
  public.video_processing,
  public.transcript_segments,
  public.parsed_creative_briefs,
  public.product_context,
  public.video_metadata,
  public.ocr_segments,
  public.visual_frames,
  public.product_frames,
  public.logo_frames
to service_role;

grant select, insert, update, delete on table
  public.agent_results,
  public.agent_result_evidence,
  public.agent_result_sub_checks
to service_role;
