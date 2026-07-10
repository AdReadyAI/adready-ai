CREATE OR REPLACE FUNCTION enqueue_job(payload jsonb)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pgmq.send('jobs', payload);
$$;

REVOKE ALL ON FUNCTION enqueue_job(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_job(jsonb) TO authenticated;