CREATE TABLE IF NOT EXISTS issuetable (
    request_id UUID PRIMARY KEY REFERENCES requests(request_id) ON DELETE CASCADE,
    batch_id UUID,
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issuetable_request_id ON issuetable(request_id);

CREATE INDEX IF NOT EXISTS idx_issuetable_metric_id ON issuetable(metric_id);

CREATE INDEX IF NOT EXISTS idx_issuetable_batch_id ON issuetable(batch_id);