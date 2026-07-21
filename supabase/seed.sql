-- Local development only. This file is run by `supabase db reset`, not by
-- `supabase db push` against the hosted project.

do $$
declare
  test_user_id constant uuid := '00000000-0000-4000-8000-000000000002';
  test_request_id constant uuid := '00000000-0000-4000-8000-000000000001';
  test_video_id constant uuid := '00000000-0000-4000-8000-000000000003';
  transcription_processing_id constant uuid := '00000000-0000-4000-8000-000000000010';
  ocr_processing_id constant uuid := '00000000-0000-4000-8000-000000000011';
  visual_processing_id constant uuid := '00000000-0000-4000-8000-000000000012';
  product_processing_id constant uuid := '00000000-0000-4000-8000-000000000013';
  logo_processing_id constant uuid := '00000000-0000-4000-8000-000000000014';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', test_user_id,
    'authenticated', 'authenticated', 'brand-agent-test@example.com',
    crypt('test-password-123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now()
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    created_at, updated_at
  ) values (
    test_user_id, test_user_id,
    jsonb_build_object('sub', test_user_id::text, 'email', 'brand-agent-test@example.com'),
    'email', 'brand-agent-test@example.com', now(), now()
  ) on conflict (provider_id, provider) do nothing;

  insert into public.requests (
    request_id, user_id, user_brief, product_url,
    campaign_goal, product_images
  ) values (
    test_request_id, test_user_id,
    'GlowUp Serum 15-second TikTok ad. Required message: highlight visible brightening in 2-4 weeks and drive viewers to glowup.com. Tone should be relatable and aspirational, targeting women 25-40 interested in skincare. Required CTA: Shop now at glowup.com. Brand logo must appear in the final 3 seconds.',
    'https://example.com/glowup-serum', 'conversion', '{}'
  ) on conflict (request_id) do nothing;

  insert into public.request_videos (
    video_id, request_id, storage_path, destination_platform, position
  ) values (
    test_video_id, test_request_id,
    'uploads/brand-agent-test/sample-glowup.mp4', 'tiktok', 0
  ) on conflict (video_id) do nothing;

  insert into public.parsed_creative_briefs (
    request_id, raw_text, brand_voice, target_audience, required_messages,
    required_ctas, approved_claims, forbidden_claims, brand_guidelines,
    policy_requirements
  ) values (
    test_request_id,
    'GlowUp Serum 15-second TikTok ad. Required message: highlight visible brightening in 2-4 weeks and drive viewers to glowup.com. Tone should be relatable and aspirational, targeting women 25-40 interested in skincare. Required CTA: Shop now at glowup.com. Brand logo must appear in the final 3 seconds.',
    'relatable, aspirational, and clear',
    'women 25-40 interested in skincare',
    array['visible brightening in 2-4 weeks'],
    array['Shop now at glowup.com'],
    array['visible results in 2-4 weeks with consistent use'],
    array['clinically proven brightening in 2 weeks'],
    array['logo appears in final 3 seconds'],
    array['avoid unsupported clinical claims']
  ) on conflict (request_id) do nothing;

  insert into public.product_context (
    request_id, raw_text, claims, contraindications, reference_asset_urls
  ) values (
    test_request_id,
    'GlowUp Serum is a vitamin C brightening serum. Product page supports visible results in 2-4 weeks with consistent use based on an internal user survey.',
    array['visible results in 2-4 weeks with consistent use'],
    array['not a formal clinical study'],
    array['https://cdn.example.com/reference/glowup_logo.png', 'https://cdn.example.com/reference/glowup_bottle_front.png']
  ) on conflict (request_id) do nothing;

  insert into public.video_metadata (
    video_id, duration_ms, aspect_ratio, resolution, dropped_frame_markers,
    corruption_detected
  ) values (
    test_video_id, 15000, '9:16', '1080x1920', '{}', false
  ) on conflict (video_id) do nothing;

  insert into public.video_processing (
    id, request_id, video_id, task_name, status, result_table
  ) values
    (transcription_processing_id, test_request_id, test_video_id, 'transcription', 'success', 'transcript_segments'),
    (ocr_processing_id, test_request_id, test_video_id, 'ocr', 'success', 'ocr_segments'),
    (visual_processing_id, test_request_id, test_video_id, 'visual_analysis', 'success', 'visual_frames'),
    (product_processing_id, test_request_id, test_video_id, 'object_detection', 'success', 'product_frames'),
    (logo_processing_id, test_request_id, test_video_id, 'logo_detection', 'success', 'logo_frames')
  on conflict (video_id, task_name) do nothing;

  insert into public.transcript_segments (
    processing_id, segment_id, start_ms, end_ms, text, speaker
  ) values
    (transcription_processing_id, 'tr_001', 0, 2500, 'Tired of dull skin every morning?', 'narrator'),
    (transcription_processing_id, 'tr_002', 9000, 12500, 'Clinically proven to brighten skin in just two weeks.', 'narrator'),
    (transcription_processing_id, 'tr_003', 12500, 15000, 'Shop now at glowup dot com.', 'narrator');

  insert into public.ocr_segments (
    processing_id, video_id, ocr_id, frame_ids, start_ms, end_ms, text,
    on_screen_duration_ms, region_size, font_size_px
  ) values (
    ocr_processing_id, test_video_id, 'ocr_001', array['frame_005'], 13000, 15000,
    'SHOP NOW - glowup.com', 2000, 0.12, 28
  ) on conflict (video_id, ocr_id) do nothing;

  insert into public.visual_frames (
    processing_id, video_id, frame_id, timestamp_ms, image_url,
    visual_description, people, color_palette, background, camera_movement,
    technical_flags
  ) values (
    visual_processing_id, test_video_id, 'frame_001', 500,
    'https://cdn.example.com/frames/request_001/frame_001.jpg',
    'Close-up of a person in dim bathroom lighting looking at their reflection.',
    '{"count":1,"apparent_age_descriptors":["adult, 30s"],"presentation_descriptors":["skincare user"],"activity":"looking in mirror","clothing_style":"casual"}'::jsonb,
    '{"dominant_colors":["blue-gray","white"],"lighting_quality":"dim"}'::jsonb,
    '{"location_type":"bathroom","mood":"frustrated"}'::jsonb,
    'static', '{}'
  ) on conflict (video_id, frame_id) do nothing;

  insert into public.product_frames (
    processing_id, video_id, frame_id, timestamp_ms, location,
    confidence_score, prominence, focus_quality, framing, usage_context
  ) values (
    product_processing_id, test_video_id, 'frame_004', 7500,
    '{"x":120,"y":840,"w":360,"h":520}'::jsonb,
    0.96, 'foreground_static', 'sharp', 'fully_visible',
    'bottle shown on counter'
  ) on conflict (video_id, frame_id) do nothing;

  insert into public.logo_frames (
    processing_id, video_id, frame_id, timestamp_ms, location,
    confidence_score, prominence, reference_match
  ) values (
    logo_processing_id, test_video_id, 'frame_005', 13500,
    '{"x":60,"y":1560,"w":180,"h":80}'::jsonb,
    0.91, 'small_corner', 'matches_reference'
  ) on conflict (video_id, frame_id) do nothing;
end;
$$;
