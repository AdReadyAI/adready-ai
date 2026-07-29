-- Persist Score Engine Result UI scores as relational columns (no jsonb blob).
-- File: 026_create_result_score_table.sql
-- Issue rows live in public.issuetable (Samy / migration 025).
-- Edge Function remains read-only; orchestrator writes after scoring.
-- Requires public.requests(request_id, batch_id) from an earlier migration.
--
-- Write path: one row in result_score_table + six rows in result_score_dimensions.
-- Dimension score NULL means Cannot Assess (API may use the string "Cannot Assess").

-- batch_id is denormalized for query (same value as requests.batch_id for this
-- request). Not a FK: requests.batch_id is not UNIQUE (many requests per batch).
CREATE TABLE IF NOT EXISTS public.result_score_table (
  request_id uuid NOT NULL REFERENCES public.requests (request_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  config_version text NOT NULL,
  ad_readiness_pct integer,
  readiness_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT result_score_table_pkey PRIMARY KEY (request_id),
  CONSTRAINT result_score_table_ad_readiness_pct_check CHECK (
    ad_readiness_pct IS NULL
    OR (ad_readiness_pct >= 0 AND ad_readiness_pct <= 100)
  ),
  CONSTRAINT result_score_table_readiness_status_check CHECK (
    readiness_status IN (
      'Ready',
      'Needs Revision',
      'High Risk',
      'Cannot Assess'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_result_score_table_batch_id
  ON public.result_score_table (batch_id);

CREATE TABLE IF NOT EXISTS public.result_score_dimensions (
  request_id uuid NOT NULL REFERENCES public.result_score_table (request_id) ON DELETE CASCADE,
  dimension_id text NOT NULL,
  name text NOT NULL,
  -- NULL = Cannot Assess
  score integer,
  CONSTRAINT result_score_dimensions_pkey PRIMARY KEY (request_id, dimension_id),
  CONSTRAINT result_score_dimensions_score_check CHECK (
    score IS NULL OR (score >= 0 AND score <= 100)
  ),
  CONSTRAINT result_score_dimensions_dimension_id_check CHECK (
    dimension_id IN (
      'claims_accuracy',
      'storyline_brief',
      'product_representation',
      'brand_alignment',
      'cta_effectiveness',
      'visual_asset_quality'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_result_score_dimensions_dimension_id
  ON public.result_score_dimensions (dimension_id);

COMMENT ON TABLE public.result_score_table IS
  'Overall Ad Ready score and status for one request (Result UI).';

COMMENT ON COLUMN public.result_score_table.batch_id IS
  'Copied from requests.batch_id for listing by batch; not a FK (batch_id is not unique).';

COMMENT ON TABLE public.result_score_dimensions IS
  'Per-dimension scores for Result UI; one row per dimension per request.';

COMMENT ON COLUMN public.result_score_dimensions.score IS
  'Integer 0–100, or NULL when Cannot Assess.';

ALTER TABLE public.result_score_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_score_dimensions ENABLE ROW LEVEL SECURITY;

-- Product auth policies TBD. Until then, only service_role bypasses RLS.
