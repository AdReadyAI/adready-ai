-- Adds Postgres log visibility around agent dispatch: pg_net is fire-and-forget
-- and the per-agent exception handler previously swallowed failures silently,
-- so nothing showed up anywhere when a call never left this function.
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

  raise log 'trigger_run_agents_on_processing_complete: dispatching % agents for request %',
    array_length(agent_names, 1), new.request_id;

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
      raise log 'trigger_run_agents_on_processing_complete: queued % for request %',
        agent_name, new.request_id;
    exception when others then
      raise warning 'trigger_run_agents_on_processing_complete: failed to queue % for request %: %',
        agent_name, new.request_id, sqlerrm;
    end;
  end loop;

  return new;
end;
$$;
