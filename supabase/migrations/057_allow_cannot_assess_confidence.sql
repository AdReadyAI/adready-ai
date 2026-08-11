-- Agents may legitimately report confidence "cannot_assess" (e.g. when a
-- qualitative check itself could not be assessed), distinct from "unknown"
-- which means no confidence was reported at all. Widen the CHECK constraint
-- created in 025_create_issues_table.sql to allow it.
ALTER TABLE public.issues DROP CONSTRAINT issues_confidence_check;

ALTER TABLE public.issues ADD CONSTRAINT issues_confidence_check CHECK (
    confidence IN (
        'low',
        'medium',
        'high',
        'cannot_assess',
        'unknown'
    )
);
