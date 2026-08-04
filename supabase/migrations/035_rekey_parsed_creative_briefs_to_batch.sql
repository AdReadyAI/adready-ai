drop table if exists public.parsed_creative_briefs;

create table public.parsed_creative_briefs (
  batch_id uuid primary key,
  raw_text text not null,
  destination_platform text not null,
  brand_voice text,
  target_audience text,
  required_messages text[] not null default '{}',
  required_ctas text[] not null default '{}',
  approved_claims text[] not null default '{}',
  forbidden_claims text[] not null default '{}',
  brand_guidelines text[] not null default '{}',
  policy_requirements text[] not null default '{}'
);

grant select, insert, update on public.parsed_creative_briefs to authenticated;

alter table public.parsed_creative_briefs enable row level security;

create policy "users read own creative brief"
  on public.parsed_creative_briefs for select to authenticated
  using (batch_id in (select batch_id from public.requests where user_id = auth.uid()));

create policy "users insert own creative brief"
  on public.parsed_creative_briefs for insert to authenticated
  with check (batch_id in (select batch_id from public.requests where user_id = auth.uid()));

create policy "users update own creative brief"
  on public.parsed_creative_briefs for update to authenticated
  using (batch_id in (select batch_id from public.requests where user_id = auth.uid()))
  with check (batch_id in (select batch_id from public.requests where user_id = auth.uid()));
