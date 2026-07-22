-- A campaign submission with N videos now fans out to N `requests` rows
-- (one video each, per the pipeline's one-video-per-request_id contract).
-- batch_id groups those rows back together for the loading/results UI.
--
-- Rebuilding the table (instead of a trailing `ADD COLUMN`) so batch_id sits
-- right after request_id instead of at the end — Postgres has no ALTER
-- TABLE column-reorder. No production data exists yet, so this drops and
-- recreates rather than copying rows across.

alter table public.video_processing
  drop constraint video_processing_request_id_fkey;

drop table public.requests;

create table public.requests (
  request_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_storage_paths text[] not null default '{}',
  user_brief text,
  product_url text,
  campaign_goal text,
  product_image_paths text[] not null default '{}',
  logo_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index requests_user_id_idx on public.requests (user_id);
create index requests_batch_id_idx on public.requests (batch_id);

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

alter table public.video_processing
  add constraint video_processing_request_id_fkey
  foreign key (request_id) references public.requests (request_id) on delete cascade;
