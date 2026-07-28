CREATE TABLE IF NOT EXISTS issuetable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES requests(batch_id) ON DELETE CASCADE,
    metric_id TEXT NOT NULL,
    title TEXT,
    detail TEXT,
    --severity TEXT CHECK (severity IN ('none', 'low', 'medium', 'high', 'critical')), 
    -- since we didnt specify the severity levels on the agent_result_sub_checks , i wanted to keep it coherent with that table, 
    --so i commented the check constraint for now. we can add it later if needed     
    severity TEXT ,
    confidence TEXT DEFAULT 'unknown',
    repair_suggestion TEXT,
    video_timestamp TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issuetable_request_id ON issuetable(request_id);

CREATE INDEX IF NOT EXISTS idx_issuetable_metric_id ON issuetable(metric_id);

CREATE INDEX IF NOT EXISTS idx_issuetable_batch_id ON issuetable(batch_id);