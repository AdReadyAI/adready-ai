create table public.parsed_creative_briefs (
  request_id uuid primary key references public.requests(request_id) on delete cascade,
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

alter table public.parsed_creative_briefs enable row level security;

create policy "users read own creative brief"
  on public.parsed_creative_briefs
  for select
  to authenticated
  using (
    request_id in (
      select request_id from public.requests
      where user_id = auth.uid()
    )
  );
