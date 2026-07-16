create table public.requests (
  request_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_storage_paths text[] not null default '{}',
  user_brief text,
  product_url text,
  campaign_goal text,
  product_images text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index requests_user_id_idx on public.requests (user_id);

grant select, insert on public.requests to authenticated;

alter table public.requests enable row level security;

create policy "users can read their own requests"
  on public.requests for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can insert their own requests"
  on public.requests for insert
  to authenticated
  with check (auth.uid() = user_id);
