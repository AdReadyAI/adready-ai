CREATE OR REPLACE FUNCTION notify_new_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('new_job', NEW.msg_id::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_jobs
  AFTER INSERT ON pgmq.q_jobs
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_job();