-- Demo helper: score an EXISTING batch that was uploaded through the real UI.
--
-- The pipeline does not yet write result_score_table / issues, so a real upload
-- sits on the processing screen forever. This fills in that last stage for a
-- batch you actually created, so the page transitions live while you watch.
--
-- Usage (batch id is the last segment of the /result/<batchId> URL):
--
--   docker cp supabase/scripts/demo_score_batch.sql supabase_db_adready-ai:/tmp/demo.sql
--   docker exec supabase_db_adready-ai psql -U postgres -d postgres \
--     -v batch_id="'PASTE-BATCH-ID-HERE'" -f /tmp/demo.sql
--
-- Works for any number of videos. Outcomes cycle Ready / Needs Revision /
-- High Risk / Cannot Assess so a 4+ video batch shows every state at once.
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING.
--
-- To reset a batch and demo the transition again:
--   delete from public.issues where batch_id = '<id>';
--   delete from public.result_score_table where batch_id = '<id>';

\set ON_ERROR_STOP on

BEGIN;

-- Position each request in the batch so outcomes are deterministic and varied.
-- Ordered by filename, not request_id: request ids are client-minted UUIDs, so
-- ordering by them scatters the outcomes randomly across videos. By filename the
-- Nth video alphabetically always gets the Nth outcome, which makes the demo
-- predictable enough to narrate.
create temporary table demo_targets on commit drop as
select
  request_id,
  batch_id,
  row_number() over (order by video_storage_paths[1], request_id) as n
from public.requests
where batch_id = :batch_id;

\echo 'Videos found in this batch:'
select count(*) as videos from demo_targets;

-- ------------------------------------------------------------ overall score
insert into public.result_score_table
  (request_id, batch_id, config_version, ad_readiness_pct, readiness_status)
select
  request_id,
  batch_id,
  '0.3',
  case (n - 1) % 4
    when 0 then 91
    when 1 then 72
    when 2 then 31
    else        null          -- Cannot Assess carries no score
  end,
  case (n - 1) % 4
    when 0 then 'Ready'
    when 1 then 'Needs Revision'
    when 2 then 'High Risk'
    else        'Cannot Assess'
  end
from demo_targets
on conflict (request_id) do nothing;

-- -------------------------------------------------------- per-dimension bars
-- Six rows per video. Cannot Assess videos get NULL everywhere; the others get
-- the overall score nudged per dimension so the bars are not all identical.
insert into public.result_score_dimensions (request_id, dimension_id, name, score)
select
  t.request_id,
  d.dimension_id,
  d.display_name,
  case
    when (t.n - 1) % 4 = 3 then null
    else greatest(0, least(100,
      case (t.n - 1) % 4 when 0 then 91 when 1 then 72 else 31 end + d.nudge
    ))
  end
from demo_targets t
cross join (values
  ('claims_accuracy',        'Claims Accuracy',        1),
  ('product_representation', 'Product Representation', 3),
  ('storyline_brief',        'Storyline & Brief',     -3),
  ('cta_effectiveness',      'CTA Effectiveness',    -17),
  ('brand_alignment',        'Brand Alignment',        6),
  ('visual_asset_quality',   'Visual / Asset Quality', 2)
) as d(dimension_id, display_name, nudge)
on conflict (request_id, dimension_id) do nothing;

-- ------------------------------------------------------------------- issues
-- Ready videos get none. Everything else gets issues matching its severity,
-- including one hidden-severity row per batch so the filtering is exercised.
insert into public.issues
  (request_id, batch_id, metric_id, title, detail, severity, confidence,
   repair_suggestion, video_timestamp)
select t.request_id, t.batch_id, i.metric_id, i.metric_id, i.detail,
       i.severity, i.confidence, i.repair, i.ts
from demo_targets t
join (values
  -- Needs Revision
  (1, 'cta_clarity', 'The closing CTA is on screen for under a second and has low contrast.',
      'high', 'medium', 'Hold the CTA card for 2s and raise contrast to meet the brand kit.', '0:22'),
  (1, 'brief_adherence', 'Required message about the summer promotion never appears.',
      'medium', 'high', 'Add the promotional line to the mid-roll caption.', '00:15'),
  (1, 'policy_compliance', 'Severity could not be classified — this row must not render.',
      'none', 'unknown', null, null),
  -- High Risk
  (2, 'product_truth', 'On-screen text says "clinically proven" with no supporting evidence.',
      'critical', 'high', 'Replace with approved language from your product page.', '0:03'),
  (2, 'product_clarity', 'The product appears for less than a second and is out of focus.',
      'high', 'medium', 'Insert a 2-3s in-focus product shot before the CTA.', '14.5'),
  (2, 'audience_channel_fit', 'Not enough signal to judge channel fit — must not render.',
      'cannot_assess', 'low', null, null),
  -- Cannot Assess
  (3, 'production_readiness', 'Source file bitrate is below the platform recommendation.',
      'low', 'low', 'Re-export at a higher bitrate before publishing.', null)
) as i(slot, metric_id, detail, severity, confidence, repair, ts)
  on i.slot = (t.n - 1) % 4
on conflict (request_id, metric_id) do nothing;

COMMIT;

\echo ''
\echo '  Batch scored. The open /result page will flip within ~5 seconds.'
\echo ''
