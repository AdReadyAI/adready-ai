-- Local-only fixtures for the sample request payloads in mango_moon.json and
-- glowup_serum.json.
-- Test account:
--   email:    seed-user@local.test
--   password: local-test-password
--
-- Both sample requests belong to this account, so its JWT can invoke the
-- JWT-protected Edge Functions for either request.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'seed-user@local.test',
  crypt('local-test-password', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false,
  now(),
  now()
)
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  confirmation_token = excluded.confirmation_token,
  recovery_token = excluded.recovery_token,
  email_change_token_new = excluded.email_change_token_new,
  email_change = excluded.email_change,
  updated_at = now();

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"seed-user@local.test"}'::jsonb,
  'email',
  'seed-user@local.test',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

-- Remove the old fixture graph before inserting it again. Every child table
-- references requests(request_id) with ON DELETE CASCADE.
delete from public.requests
where request_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '00000000-0000-4000-8000-000000000001'
);

insert into public.requests (
  request_id,
  user_id,
  video_storage_paths,
  user_brief,
  product_url,
  campaign_goal,
  product_image_paths,
  logo_paths
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    array['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mango-moon.mp4'],
    'Launch spot for Mango Moon, a tropical energy drink. Communicate fun, refreshing tropical energy for Gen-Z snackers. Required CTA: ''Try Mango Moon''. Drive to mangomoon.com.',
    'https://mangomoon.com',
    'conversion',
    array['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mango-moon-can.png'],
    array['11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mango-moon-logo.png']
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    array['11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000001/glowup-serum.mp4'],
    'GlowUp Serum 15-second TikTok ad. Required message: highlight visible brightening in 2-4 weeks and drive viewers to glowup.com. Tone should be relatable and aspirational, targeting women 25-40 interested in skincare. Required CTA: Shop now at glowup.com. Brand logo must appear in the final 3 seconds.',
    'https://glowup.com',
    'conversion',
    array['11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000001/glowup-serum-bottle.png'],
    array['11111111-1111-4111-8111-111111111111/00000000-0000-4000-8000-000000000001/glowup-logo.png']
  );

insert into public.parsed_creative_briefs (
  request_id,
  raw_text,
  destination_platform,
  brand_voice,
  target_audience,
  required_messages,
  required_ctas,
  approved_claims,
  forbidden_claims,
  brand_guidelines,
  policy_requirements
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Launch spot for Mango Moon, a tropical energy drink. Communicate fun, refreshing tropical energy for Gen-Z snackers. Required CTA: ''Try Mango Moon''. Drive to mangomoon.com.',
    'tiktok',
    'playful, high-energy, casual',
    'Gen-Z, 18-24, snack and energy-drink buyers',
    array['fun tropical energy', 'refreshing'],
    array['Try Mango Moon'],
    array['natural flavors', '40mg caffeine'],
    array['boosts metabolism', 'clinically proven'],
    array['use the coral + teal palette', 'logo bottom-right'],
    array['show ''contains caffeine'' disclaimer']
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'GlowUp Serum 15-second TikTok ad. Required message: highlight visible brightening in 2-4 weeks and drive viewers to glowup.com. Tone should be relatable and aspirational, targeting women 25-40 interested in skincare. Required CTA: Shop now at glowup.com. Brand logo must appear in the final 3 seconds.',
    'tiktok',
    'relatable, aspirational, and clear',
    'women 25-40 interested in skincare',
    array['visible brightening in 2-4 weeks'],
    array['Shop now at glowup.com'],
    array['visible results in 2-4 weeks with consistent use'],
    array['clinically proven brightening in 2 weeks'],
    array['logo appears in final 3 seconds'],
    array['avoid unsupported clinical claims']
  );

insert into public.video_metadata (
  request_id,
  duration_ms,
  aspect_ratio,
  resolution,
  dropped_frame_markers,
  corruption_detected
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 15000, '9:16', '1080x1920', '{}', false),
  ('00000000-0000-4000-8000-000000000001', 15000, '9:16', '1080x1920', '{}', false);

insert into public.video_processing (id, request_id, task_name, status)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'transcription', 'success'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'transcription', 'success');

insert into public.transcript_segments (processing_id, segment_id, start_ms, end_ms, text, speaker)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 't1', 0, 2500, 'Thirsty? Meet Mango Moon.', 'narrator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 't2', 2500, 8000, 'Real tropical mango, a splash of citrus, and just enough kick to keep you going.', 'narrator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 't3', 8000, 12000, 'Ice cold, endlessly refreshing.', 'narrator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 't4', 12000, 15000, 'Try Mango Moon today at mangomoon dot com.', 'narrator'),
  ('00000000-0000-4000-8000-000000000101', 'tr_001', 0, 2500, 'Tired of dull skin every morning?', 'narrator'),
  ('00000000-0000-4000-8000-000000000101', 'tr_002', 9000, 12500, 'Clinically proven to brighten skin in just two weeks.', 'narrator'),
  ('00000000-0000-4000-8000-000000000101', 'tr_003', 12500, 15000, 'Shop now at glowup dot com.', 'narrator');

insert into public.ocr_segments (
  request_id, ocr_id, frame_ids, start_ms, end_ms, text,
  on_screen_duration_ms, region_size, font_size_px
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'o1', array['f4'], 12500, 15000, 'Try Mango Moon', 2500, 0.22, 64),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'o2', array['f4'], 13000, 15000, 'mangomoon.com', 2000, 0.09, 34),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'o3', array['f2'], 4000, 6000, 'Contains caffeine', 2000, 0.03, 18),
  ('00000000-0000-4000-8000-000000000001', 'ocr_001', array['frame_005'], 13000, 15000, 'SHOP NOW - glowup.com', 2000, 0.12, 28);

insert into public.visual_frames (
  request_id, frame_id, timestamp_ms, image_url, visual_description, people,
  color_palette, background, camera_movement, technical_flags
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1', 500,
    'https://cdn.example.com/frames/mango-moon/f1.jpg',
    'Close-up of a frosty Mango Moon can being pulled from ice, condensation dripping, bright sunlight.',
    '{"count":0,"apparent_ages":[],"apparent_presentation":[],"activity":"product reveal","clothing_style":"not applicable"}'::jsonb,
    '{"dominant_colors":["coral","teal","white"],"lighting_quality":"bright sunlight"}'::jsonb,
    '{"location_type":"ice cooler","mood":"refreshing"}'::jsonb,
    'zoom', '{}'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2', 5000,
    'https://cdn.example.com/frames/mango-moon/f2.jpg',
    'A young woman on a rooftop takes a sip and smiles; coral and teal color grade; can label clearly visible.',
    '{"count":1,"apparent_ages":["adult, 20s"],"apparent_presentation":["Gen-Z energy-drink customer"],"activity":"drinking Mango Moon","clothing_style":"casual streetwear"}'::jsonb,
    '{"dominant_colors":["coral","teal","gold"],"lighting_quality":"warm daylight"}'::jsonb,
    '{"location_type":"rooftop","mood":"playful"}'::jsonb,
    'handheld', '{}'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f3', 9500,
    'https://cdn.example.com/frames/mango-moon/f3.jpg',
    'Slow-motion pour over ice with mango slices splashing.',
    '{"count":0,"apparent_ages":[],"apparent_presentation":[],"activity":"product pour","clothing_style":"not applicable"}'::jsonb,
    '{"dominant_colors":["mango orange","coral","teal"],"lighting_quality":"high-key studio"}'::jsonb,
    '{"location_type":"studio product set","mood":"energetic"}'::jsonb,
    'static', '{}'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f4', 13500,
    'https://cdn.example.com/frames/mango-moon/f4.jpg',
    'End card: the can centered on a teal background with ''Try Mango Moon'' and the URL, logo bottom-right.',
    '{"count":0,"apparent_ages":[],"apparent_presentation":[],"activity":"end card","clothing_style":"not applicable"}'::jsonb,
    '{"dominant_colors":["teal","coral","white"],"lighting_quality":"clean graphic"}'::jsonb,
    '{"location_type":"graphic end card","mood":"confident"}'::jsonb,
    'static', '{}'
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'frame_001',
    500,
    'https://cdn.example.com/frames/request_001/frame_001.jpg',
    'Close-up of a person in dim bathroom lighting looking at their reflection.',
    '{"count":1,"apparent_ages":["adult, 30s"],"apparent_presentation":["skincare user"],"activity":"looking in mirror","clothing_style":"casual"}'::jsonb,
    '{"dominant_colors":["blue-gray","white"],"lighting_quality":"dim"}'::jsonb,
    '{"location_type":"bathroom","mood":"frustrated"}'::jsonb,
    'static',
    '{}'
  );

insert into public.product_frames (
  request_id, frame_id, timestamp_ms, location, confidence_score, prominence,
  focus_quality, framing, usage_context
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1', 500, '{"x":370,"y":420,"w":340,"h":760}'::jsonb, 0.98, 'foreground_in_use', 'sharp', 'fully_visible', 'product hero shot'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f2', 5000, '{"x":420,"y":600,"w":270,"h":520}'::jsonb, 0.90, 'foreground_static', 'sharp', 'fully_visible', 'held while drinking'),
  ('00000000-0000-4000-8000-000000000001', 'frame_004', 7500, '{"x":120,"y":840,"w":360,"h":520}'::jsonb, 0.96, 'foreground_static', 'sharp', 'fully_visible', 'bottle shown on counter');

insert into public.logo_frames (
  request_id, frame_id, timestamp_ms, location, confidence_score, prominence,
  reference_match
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f4', 13500, '{"x":820,"y":1700,"w":160,"h":120}'::jsonb, 0.95, 'small_corner', 'matches_reference'),
  ('00000000-0000-4000-8000-000000000001', 'frame_005', 13500, '{"x":60,"y":1560,"w":180,"h":80}'::jsonb, 0.91, 'small_corner', 'matches_reference');

insert into public.product_context (
  request_id, raw_text, claims, contraindications, reference_asset_urls
)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Mango Moon — sparkling tropical energy drink. 40mg caffeine from green tea. Natural mango and citrus flavors.',
    array['40mg caffeine', 'natural flavors'],
    array['not recommended for children'],
    array['https://example.test/mango-moon-can.png']
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'GlowUp Serum is a vitamin C brightening serum. Product page supports visible results in 2-4 weeks with consistent use based on an internal user survey.',
    array['visible results in 2-4 weeks with consistent use'],
    array['not a formal clinical study'],
    array['https://cdn.example.com/reference/glowup_logo.png', 'https://cdn.example.com/reference/glowup_bottle_front.png']
  );
