-- Replace one Launch-Readiness Scorecard atomically. The parent score and all
-- six display dimensions become visible together or the complete write rolls
-- back, preventing the Result UI from observing a mixed scorecard.
create or replace function public.replace_launch_readiness_scorecard(
  p_request_id uuid,
  p_batch_id uuid,
  p_config_version text,
  p_ad_readiness_pct integer,
  p_readiness_status text,
  p_dimensions jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dimension jsonb;
begin
  if jsonb_typeof(p_dimensions) <> 'array'
    or jsonb_array_length(p_dimensions) <> 6 then
    raise exception 'Scorecard must contain exactly six dimensions';
  end if;

  if not exists (
    select 1
    from public.requests
    where request_id = p_request_id
      and batch_id = p_batch_id
  ) then
    raise exception 'Request and batch do not match';
  end if;

  -- Duplicate queue deliveries for one request must not interleave their
  -- parent and child replacements inside separate transactions.
  perform pg_advisory_xact_lock(hashtext(p_request_id::text));

  insert into public.result_score_table (
    request_id,
    batch_id,
    config_version,
    ad_readiness_pct,
    readiness_status,
    updated_at
  )
  values (
    p_request_id,
    p_batch_id,
    p_config_version,
    p_ad_readiness_pct,
    p_readiness_status,
    timezone('utc'::text, now())
  )
  on conflict (request_id) do update
  set
    batch_id = excluded.batch_id,
    config_version = excluded.config_version,
    ad_readiness_pct = excluded.ad_readiness_pct,
    readiness_status = excluded.readiness_status,
    updated_at = excluded.updated_at;

  delete from public.result_score_dimensions
  where request_id = p_request_id;

  -- The table constraints validate dimension identifiers and scores while the
  -- primary key rejects duplicates, rolling back the complete replacement.
  for dimension in
    select value from jsonb_array_elements(p_dimensions)
  loop
    insert into public.result_score_dimensions (
      request_id,
      dimension_id,
      name,
      score
    )
    values (
      p_request_id,
      dimension->>'dimension_id',
      dimension->>'name',
      (dimension->>'score')::integer
    );
  end loop;
end;
$$;

revoke all on function public.replace_launch_readiness_scorecard(
  uuid,
  uuid,
  text,
  integer,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.replace_launch_readiness_scorecard(
  uuid,
  uuid,
  text,
  integer,
  text,
  jsonb
) to service_role;
