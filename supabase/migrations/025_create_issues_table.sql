CREATE TABLE IF NOT EXISTS issues (
    request_id UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES requests(batch_id) ON DELETE CASCADE,
    metric_id TEXT NOT NULL,
    title TEXT,
    detail TEXT,
    --severity TEXT CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')),
    -- since we didn't specify the severity levels on the agent_result_sub_checks,
    -- I wanted to keep it coherent with that table,
    -- so I commented the check constraint for now. We can add it later if needed.
    severity TEXT,
    confidence TEXT DEFAULT 'unknown',
    repair_suggestion TEXT,
    video_timestamp TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,

    PRIMARY KEY (request_id, metric_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_batch_id ON issues(batch_id);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;