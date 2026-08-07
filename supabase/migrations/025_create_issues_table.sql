ALTER TABLE public.requests ADD CONSTRAINT requests_request_id_batch_id_key UNIQUE (request_id, batch_id);
 
CREATE TABLE IF NOT EXISTS public.issues (
    request_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    metric_id TEXT NOT NULL,

    title TEXT,
    detail TEXT,

    severity TEXT NOT NULL CHECK (
        severity IN (
            'none',
            'low',
            'medium',
            'high',
            'critical',
            'cannot_assess'
        )
    ),

    confidence TEXT DEFAULT 'unknown' CHECK (
        confidence IN (
            'low',
            'medium',
            'high',
            'unknown'
        )
    ),

    repair_suggestion TEXT,
    video_timestamp TEXT,

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,

    PRIMARY KEY (request_id, metric_id),

    CONSTRAINT issues_request_batch_fkey
        FOREIGN KEY (request_id, batch_id)
        REFERENCES public.requests (request_id, batch_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issues_batch_id
ON public.issues(batch_id);

ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;