CREATE TABLE transcript_segments (
    processing_id  uuid NOT NULL REFERENCES video_processing(id) ON DELETE CASCADE,
    segment_id     text NOT NULL,
    start_ms       integer NOT NULL,
    end_ms         integer NOT NULL,
    text           text NOT NULL,
    speaker        text
);

CREATE INDEX idx_transcript_segments_processing_id ON transcript_segments (processing_id);
