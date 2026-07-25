create table public.product_context (
  request_id uuid primary key references public.requests(request_id) on delete cascade,
  raw_text text,
  claims text[] not null default '{}',
  contraindications text[] not null default '{}',
  reference_asset_urls text[] not null default '{}'
);
