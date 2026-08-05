-- Keep diagnostic OCR evidence beside, but outside, the stable evaluator-facing
-- OCR Segment contract. Every row belongs to one immutable OCR Result.
create table public.ocr_segment_evidence (
  ocr_run_id uuid not null
    references public.ocr_results(ocr_run_id) on delete cascade,
  ocr_id text not null,
  rectangle numeric[] not null
    check (cardinality(rectangle) = 4),
  confidence numeric
    check (confidence is null or confidence between 0 and 1),
  representative_frame_index integer not null
    check (representative_frame_index >= 0),
  supporting_frame_indexes integer[] not null default '{}',
  supporting_readings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(supporting_readings) = 'array'),
  source_text_segment_ids text[] not null default '{}',
  primary key (ocr_run_id, ocr_id)
);

alter table public.ocr_segment_evidence enable row level security;

create table public.ocr_text_segments (
  ocr_run_id uuid not null
    references public.ocr_results(ocr_run_id) on delete cascade,
  text_segment_id text not null,
  estimated_start_ms integer not null,
  estimated_end_ms integer not null,
  duration_ms integer not null check (duration_ms >= 0),
  observed_start_ms integer not null,
  observed_end_ms integer not null,
  timing_uncertainty_ms integer not null
    check (timing_uncertainty_ms >= 0),
  rectangle numeric[] not null
    check (cardinality(rectangle) = 4),
  detector_confidence numeric
    check (
      detector_confidence is null
      or detector_confidence between 0 and 1
    ),
  representative_frame_index integer not null
    check (representative_frame_index >= 0),
  candidate_sources text[] not null default '{}',
  missed_observations integer not null
    check (missed_observations >= 0),
  observations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(observations) = 'array'),
  ocr_segment_ids text[] not null default '{}',
  primary key (ocr_run_id, text_segment_id),
  check (estimated_end_ms >= estimated_start_ms),
  check (observed_end_ms >= observed_start_ms)
);

alter table public.ocr_text_segments enable row level security;

-- The worker reads completed evidence through its run identity. Mutations stay
-- behind complete_ocr_run so redelivery cannot alter diagnostic provenance.
revoke insert, update, delete
  on table public.ocr_segment_evidence, public.ocr_text_segments
  from service_role;

grant select
  on table public.ocr_segment_evidence, public.ocr_text_segments
  to service_role;

create or replace function public.complete_ocr_run(
  p_ocr_run_id uuid,
  p_segments jsonb,
  p_ocr_evidence jsonb,
  p_text_provenance jsonb
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
  if jsonb_typeof(p_ocr_evidence) is distinct from 'array' then
    raise exception 'OCR Segment evidence must be a JSON array';
  end if;
  if jsonb_typeof(p_text_provenance) is distinct from 'array' then
    raise exception 'Text Segment provenance must be a JSON array';
  end if;

  -- Locking serializes concurrent redeliveries. The immutable result header
  -- remains authoritative before any evaluator or diagnostic rows are added.
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

  insert into public.ocr_segment_evidence (
    ocr_run_id,
    ocr_id,
    rectangle,
    confidence,
    representative_frame_index,
    supporting_frame_indexes,
    supporting_readings,
    source_text_segment_ids
  )
  select
    p_ocr_run_id,
    evidence.identifier,
    evidence.rectangle,
    evidence.confidence,
    evidence.representative_frame_index,
    evidence.supporting_frame_indexes,
    evidence.supporting_readings,
    evidence.source_text_segment_ids
  from jsonb_to_recordset(p_ocr_evidence) as evidence(
    identifier text,
    rectangle numeric[],
    confidence numeric,
    representative_frame_index integer,
    supporting_frame_indexes integer[],
    supporting_readings jsonb,
    source_text_segment_ids text[]
  );

  insert into public.ocr_text_segments (
    ocr_run_id,
    text_segment_id,
    estimated_start_ms,
    estimated_end_ms,
    duration_ms,
    observed_start_ms,
    observed_end_ms,
    timing_uncertainty_ms,
    rectangle,
    detector_confidence,
    representative_frame_index,
    candidate_sources,
    missed_observations,
    observations,
    ocr_segment_ids
  )
  select
    p_ocr_run_id,
    provenance.identifier,
    round(provenance.start_s * 1000)::integer,
    round(provenance.end_s * 1000)::integer,
    round(provenance.duration_s * 1000)::integer,
    coalesce(
      (
        select min(round((observation->>1)::numeric * 1000)::integer)
        from jsonb_array_elements(provenance.observations) as observation
      ),
      round(provenance.start_s * 1000)::integer
    ),
    coalesce(
      (
        select max(round((observation->>1)::numeric * 1000)::integer)
        from jsonb_array_elements(provenance.observations) as observation
      ),
      round(provenance.end_s * 1000)::integer
    ),
    round(provenance.timing_uncertainty_s * 1000)::integer,
    provenance.rectangle,
    provenance.detector_confidence,
    provenance.representative_frame_index,
    provenance.candidate_sources,
    provenance.missed_observations,
    provenance.observations,
    provenance.ocr_segment_ids
  from jsonb_to_recordset(p_text_provenance) as provenance(
    identifier text,
    start_s numeric,
    end_s numeric,
    duration_s numeric,
    timing_uncertainty_s numeric,
    rectangle numeric[],
    detector_confidence numeric,
    representative_frame_index integer,
    candidate_sources text[],
    missed_observations integer,
    observations jsonb,
    ocr_segment_ids text[]
  );

  update public.ocr_runs
  set status = 'completed',
      error = null,
      updated_at = now()
  where ocr_run_id = p_ocr_run_id;

  return true;
end;
$$;

-- Run-owned evaluator rows may now be inserted only by the four-argument
-- atomic completion function that also owns their diagnostic provenance.
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
       where oid = (
         'public.complete_ocr_run(uuid,jsonb,jsonb,jsonb)'
       )::regprocedure
     ) then
    raise exception
      'run-owned OCR Segment can only be inserted by complete_ocr_run';
  end if;

  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

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

revoke execute
  on function public.complete_ocr_run(uuid, jsonb, jsonb, jsonb)
  from public;

grant execute
  on function public.complete_ocr_run(uuid, jsonb, jsonb, jsonb)
  to service_role;

drop function public.complete_ocr_run(uuid, jsonb);
