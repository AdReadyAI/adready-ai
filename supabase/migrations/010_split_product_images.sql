alter table public.requests
  rename column product_images to product_image_paths;

alter table public.requests
  add column logo_paths text[] not null default '{}';
