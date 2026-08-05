-- One immutable OCR Result belongs to one durable OCR Run. The separate
-- header represents successful empty results as well as results with segments.
create table public.ocr_results (
  ocr_run_id uuid primary key
    references public.ocr_runs(ocr_run_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ocr_results enable row level security;

-- Existing request-scoped OCR rows predate OCR Runs. Keeping this nullable
-- preserves legacy data while every new result written through the function
-- below receives an explicit run identity.
alter table public.ocr_segments
  add column ocr_run_id uuid
    references public.ocr_results(ocr_run_id) on delete cascade;

create unique index ocr_segments_run_identifier_idx
  on public.ocr_segments (ocr_run_id, ocr_id)
  where ocr_run_id is not null;

create index ocr_segments_run_lookup_idx
  on public.ocr_segments (ocr_run_id)
  where ocr_run_id is not null;

-- The OCR Result header is append-only for the worker. Redelivery must reuse
-- the first completed result rather than replacing it.
revoke update, delete
  on table public.ocr_results
  from service_role;

grant select
  on table public.ocr_results
  to service_role;
grant select, insert, update, delete
  on table public.ocr_segments
  to service_role;

create or replace function public.prevent_run_owned_ocr_segment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     and new.ocr_run_id is not null
     and current_user <> (
       select pg_get_userbyid(proowner)
       from pg_proc
       where oid = 'public.complete_ocr_run(uuid,jsonb)'::regprocedure
     ) then
    raise exception
      'run-owned OCR Segment can only be inserted by complete_ocr_run';
  end if;

  -- Foreign-key cleanup remains valid when the owning Review Request and OCR
  -- Run are deleted. Direct worker deletion enters at trigger depth one.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- Legacy request-scoped rows remain governed by their existing contract.
  -- Only segments belonging to an immutable OCR Result are protected here.
  if old.ocr_run_id is not null
     or (tg_op = 'UPDATE' and new.ocr_run_id is not null) then
    raise exception 'run-owned OCR Segment is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger prevent_run_owned_ocr_segment_mutation
before insert or update or delete on public.ocr_segments
for each row
execute function public.prevent_run_owned_ocr_segment_mutation();

create or replace function public.complete_ocr_run(
  p_ocr_run_id uuid,
  p_segments jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  run_request_id uuid;
  result_created boolean;
begin
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'OCR Result segments must be a JSON array';
  end if;

  -- Locking serializes concurrent redeliveries for the same OCR Run. The
  -- result header remains the authoritative idempotency record.
  select request_id
  into run_request_id
  from public.ocr_runs
  where ocr_run_id = p_ocr_run_id
  for update;

  if run_request_id is null then
    raise exception 'OCR Run % does not exist', p_ocr_run_id;
  end if;

  insert into public.ocr_results (ocr_run_id)
  values (p_ocr_run_id)
  on conflict (ocr_run_id) do nothing
  returning true into result_created;

  if not coalesce(result_created, false) then
    return false;
  end if;

  insert into public.ocr_segments (
    request_id,
    ocr_run_id,
    ocr_id,
    frame_ids,
    start_ms,
    end_ms,
    text,
    on_screen_duration_ms,
    region_size,
    font_size_px
  )
  select
    run_request_id,
    p_ocr_run_id,
    segment.ocr_id,
    segment.frame_ids,
    segment.start_ms,
    segment.end_ms,
    segment.text,
    segment.on_screen_duration_ms,
    segment.region_size,
    segment.font_size_px
  from jsonb_to_recordset(p_segments) as segment(
    ocr_id text,
    frame_ids text[],
    start_ms integer,
    end_ms integer,
    text text,
    on_screen_duration_ms integer,
    region_size numeric,
    font_size_px integer
  );

  update public.ocr_runs
  set status = 'completed',
      error = null,
      updated_at = now()
  where ocr_run_id = p_ocr_run_id;

  return true;
end;
$$;

revoke execute
  on function public.complete_ocr_run(uuid, jsonb)
  from public;

grant execute
  on function public.complete_ocr_run(uuid, jsonb)
  to service_role;
