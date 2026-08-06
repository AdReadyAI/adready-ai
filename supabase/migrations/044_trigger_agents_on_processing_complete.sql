-- Fires the agent pipeline once every video_processing task for a request
-- has left the 'processing' state, whether it landed on 'success' or
-- 'error'. Guarded by requests.agents_triggered_at so a later pgmq
-- redelivery that flips an errored task to 'success' does not re-fire.
alter table public.requests
  add column agents_triggered_at timestamptz;

create or replace function public.video_processing_all_done(p_request_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from public.video_processing
    where request_id = p_request_id and status = 'processing'
  );
$$;

create or replace function public.trigger_run_agents_on_processing_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  already_triggered timestamptz;
  base_url text;
  trigger_secret text;
  agent_name text;
  agent_names text[] := array[
    'claims-agent',
    'storyline-clarity-agent',
    'cta-effectiveness-agent',
    'product-representation-agent',
    'visual-quality-agent',
    'brand-alignment-agent',
    'brief-alignment-agent'
  ];
begin
  select agents_triggered_at into already_triggered
  from public.requests
  where request_id = new.request_id
  for update;

  if already_triggered is not null then
    return new;
  end if;

  if not public.video_processing_all_done(new.request_id) then
    return new;
  end if;

  update public.requests
  set agents_triggered_at = now()
  where request_id = new.request_id;

  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'edge_functions_base_url';
  -- Dedicated secret, distinct from the service-role key, so a leak here
  -- only grants access to these functions rather than full DB access.
  select decrypted_secret into trigger_secret
  from vault.decrypted_secrets where name = 'internal_trigger_secret';

  -- Each call is isolated so a bad call for one agent (or pg_net itself)
  -- can never roll back the guard-column update above, or the worker's own
  -- video_processing write that fired this trigger.
  foreach agent_name in array agent_names loop
    begin
      perform net.http_post(
        url := base_url || '/' || agent_name,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || trigger_secret
        ),
        body := jsonb_build_object('request_id', new.request_id)
      );
    exception when others then
      null;
    end;
  end loop;

  return new;
end;
$$;

-- video_processing rows are always inserted with status = 'processing' (see
-- Supabase._upsert_processing), so only UPDATE transitions matter here.
create trigger trg_run_agents_on_processing_complete
  after update of status on public.video_processing
  for each row
  when (new.status <> 'processing')
  execute function public.trigger_run_agents_on_processing_complete();
