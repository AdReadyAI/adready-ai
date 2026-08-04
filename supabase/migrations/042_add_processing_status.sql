ALTER TABLE video_processing
    DROP CONSTRAINT video_processing_status_check;

ALTER TABLE video_processing
    ADD CONSTRAINT video_processing_status_check
    CHECK (status IN ('processing', 'success', 'error'));
