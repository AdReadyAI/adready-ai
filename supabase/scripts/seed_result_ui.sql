-- Dev seed for the Result UI (issues + result_score_* → /result).
--
-- Run against the LOCAL database only:
--   docker cp supabase/scripts/seed_result_ui.sql supabase_db_adready-ai:/tmp/seed.sql
--   docker exec supabase_db_adready-ai psql -U postgres -d postgres -f /tmp/seed.sql
--
-- Creates a dev login and one batch of five videos chosen to exercise every
-- branch the Result UI has to handle. Fixed UUIDs + ON CONFLICT DO NOTHING, so
-- re-running is safe and idempotent.
--
-- Coverage:
--   Video_1  Ready           91    no issues at all
--   Video_2  Needs Revision  72    high + medium + one `none` (must be hidden)
--   Video_3  High Risk       31    critical + high + one `cannot_assess` (hidden)
--   Video_4  Cannot Assess   NULL  NULL dimension scores, one `low` issue
--   Video_5  Needs Revision  72    ties with Video_2 -> exercises filename tiebreak
-- Video_2 also has one NULL dimension score, so a single missing bar can be
-- told apart from a wholly unassessable video.
-- video_timestamp deliberately varies: "0:22", "00:15", "14.5", and NULL.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------- dev user
-- Password: devpassword123
-- The empty strings are not decoration. GoTrue scans these token columns into
-- non-nullable Go strings, so leaving them NULL makes every login fail with
-- "Database error querying schema" (HTTP 500) rather than a credentials error.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated',
  'dev@adready.test',
  crypt('devpassword123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', '', '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"dev@adready.test","email_verified":true}'::jsonb,
  'email', now(), now()
)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ requests
-- trg_enqueue_job_on_request_insert pushes a real job onto pgmq for every row,
-- and the worker container would then try to process video paths that do not
-- exist. Suppress just that trigger; foreign keys stay enforced, and the
-- re-enable is in the same transaction so a rollback cannot leave it off.
alter table public.requests disable trigger trg_enqueue_job_on_request_insert;

insert into public.requests
  (request_id, batch_id, user_id, video_storage_paths, user_brief, product_url, campaign_goal)
values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111/seed/video/1/Video_1.mp4'],'Seed brief','https://example.com/product','Awareness'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111/seed/video/2/Video_2.mp4'],'Seed brief','https://example.com/product','Awareness'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111/seed/video/3/Video_3.mp4'],'Seed brief','https://example.com/product','Awareness'),
  ('aaaaaaaa-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111/seed/video/4/Video_4.mp4'],'Seed brief','https://example.com/product','Awareness'),
  ('aaaaaaaa-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111/seed/video/5/Video_5.mp4'],'Seed brief','https://example.com/product','Awareness')
on conflict (request_id) do nothing;

alter table public.requests enable trigger trg_enqueue_job_on_request_insert;

-- ------------------------------------------------------------ overall scores
insert into public.result_score_table
  (request_id, batch_id, config_version, ad_readiness_pct, readiness_status)
values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b','0.3',  91,'Ready'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','0.3',  72,'Needs Revision'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-00000000000b','0.3',  31,'High Risk'),
  ('aaaaaaaa-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','0.3',NULL,'Cannot Assess'),
  ('aaaaaaaa-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-00000000000b','0.3',  72,'Needs Revision')
on conflict (request_id) do nothing;

-- -------------------------------------------------------- per-dimension bars
insert into public.result_score_dimensions (request_id, dimension_id, name, score)
values
  -- Video_1 — Ready
  ('aaaaaaaa-0000-0000-0000-000000000001','claims_accuracy',       'Claims Accuracy',      92),
  ('aaaaaaaa-0000-0000-0000-000000000001','storyline_brief',       'Storyline & Brief',    90),
  ('aaaaaaaa-0000-0000-0000-000000000001','product_representation','Product Representation',94),
  ('aaaaaaaa-0000-0000-0000-000000000001','brand_alignment',       'Brand Alignment',      88),
  ('aaaaaaaa-0000-0000-0000-000000000001','cta_effectiveness',     'CTA Effectiveness',    89),
  ('aaaaaaaa-0000-0000-0000-000000000001','visual_asset_quality',  'Visual / Asset Quality',93),
  -- Video_2 — Needs Revision, one NULL bar (Cannot Assess for that dimension only)
  ('aaaaaaaa-0000-0000-0000-000000000002','claims_accuracy',       'Claims Accuracy',      70),
  ('aaaaaaaa-0000-0000-0000-000000000002','storyline_brief',       'Storyline & Brief',    68),
  ('aaaaaaaa-0000-0000-0000-000000000002','product_representation','Product Representation',75),
  ('aaaaaaaa-0000-0000-0000-000000000002','brand_alignment',       'Brand Alignment',    NULL),
  ('aaaaaaaa-0000-0000-0000-000000000002','cta_effectiveness',     'CTA Effectiveness',    55),
  ('aaaaaaaa-0000-0000-0000-000000000002','visual_asset_quality',  'Visual / Asset Quality',74),
  -- Video_3 — High Risk, includes a genuine 0
  ('aaaaaaaa-0000-0000-0000-000000000003','claims_accuracy',       'Claims Accuracy',      20),
  ('aaaaaaaa-0000-0000-0000-000000000003','storyline_brief',       'Storyline & Brief',    35),
  ('aaaaaaaa-0000-0000-0000-000000000003','product_representation','Product Representation',30),
  ('aaaaaaaa-0000-0000-0000-000000000003','brand_alignment',       'Brand Alignment',      42),
  ('aaaaaaaa-0000-0000-0000-000000000003','cta_effectiveness',     'CTA Effectiveness',     0),
  ('aaaaaaaa-0000-0000-0000-000000000003','visual_asset_quality',  'Visual / Asset Quality',15),
  -- Video_4 — Cannot Assess: every bar NULL
  ('aaaaaaaa-0000-0000-0000-000000000004','claims_accuracy',       'Claims Accuracy',    NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004','storyline_brief',       'Storyline & Brief',  NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004','product_representation','Product Representation',NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004','brand_alignment',       'Brand Alignment',    NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004','cta_effectiveness',     'CTA Effectiveness',  NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004','visual_asset_quality',  'Visual / Asset Quality',NULL),
  -- Video_5 — ties with Video_2 on the overall score
  ('aaaaaaaa-0000-0000-0000-000000000005','claims_accuracy',       'Claims Accuracy',      71),
  ('aaaaaaaa-0000-0000-0000-000000000005','storyline_brief',       'Storyline & Brief',    73),
  ('aaaaaaaa-0000-0000-0000-000000000005','product_representation','Product Representation',69),
  ('aaaaaaaa-0000-0000-0000-000000000005','brand_alignment',       'Brand Alignment',      77),
  ('aaaaaaaa-0000-0000-0000-000000000005','cta_effectiveness',     'CTA Effectiveness',    64),
  ('aaaaaaaa-0000-0000-0000-000000000005','visual_asset_quality',  'Visual / Asset Quality',72)
on conflict (request_id, dimension_id) do nothing;

-- ------------------------------------------------------------------- issues
-- Video_1 intentionally has none.
insert into public.issues
  (request_id, batch_id, metric_id, title, detail, severity, confidence, repair_suggestion, video_timestamp)
values
  -- Video_2: high + medium shown; `none` must be filtered out by the UI
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','cta_clarity','cta_clarity',
   'The closing CTA is on screen for under a second and has low contrast.','high','medium',
   'Hold the CTA card for 2s and raise contrast to meet the brand kit.','0:22'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','brief_adherence','brief_adherence',
   'Required message about the summer promotion never appears.','medium','high',
   'Add the promotional line to the mid-roll caption.','00:15'),
  ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','policy_compliance','policy_compliance',
   'Severity could not be classified upstream — should be hidden.','none','unknown',
   NULL, NULL),

  -- Video_3: critical + high shown; `cannot_assess` must be filtered out
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-00000000000b','product_truth','product_truth',
   'On-screen text says "clinically proven" but the product page has no supporting evidence.','critical','high',
   'Replace "clinically proven" with approved language from your product page.','0:03'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-00000000000b','product_clarity','product_clarity',
   'The product appears for less than a second and is out of focus.','high','medium',
   'Insert a 2-3s in-focus product shot before the CTA.','14.5'),
  ('aaaaaaaa-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-00000000000b','audience_channel_fit','audience_channel_fit',
   'Not enough signal to judge channel fit — should be hidden.','cannot_assess','low',
   NULL, NULL),

  -- Video_4: Cannot Assess overall, but still carries one low-severity issue
  ('aaaaaaaa-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-00000000000b','production_readiness','production_readiness',
   'Source file bitrate is below the platform recommendation.','low','low',
   'Re-export at a higher bitrate before publishing.',NULL),

  -- Video_5: ties with Video_2 on score; one medium issue
  ('aaaaaaaa-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-00000000000b','creative_effectiveness','creative_effectiveness',
   'The middle third loses momentum; viewers are likely to drop off.','medium','medium',
   'Trim ~3s of B-roll to keep the narrative moving.','0:19')
on conflict (request_id, metric_id) do nothing;

COMMIT;

\echo ''
\echo '  Seeded.'
\echo '  Login:  dev@adready.test / devpassword123'
\echo '  Route:  /result/bbbbbbbb-0000-0000-0000-00000000000b'
\echo ''
