CREATE TABLE video_processing (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id    uuid NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    task_name     text NOT NULL CHECK (
        task_name IN ('transcription', 'frame_text', 'object_detection', 'context')
    ),
    status        text NOT NULL CHECK (status IN ('success', 'error')),
    result_table  text,
    error         text,
    updated_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (request_id, task_name)
);

CREATE INDEX idx_video_processing_request_id ON video_processing (request_id);
