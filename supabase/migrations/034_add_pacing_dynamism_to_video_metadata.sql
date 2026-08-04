alter table public.video_metadata
  add column shot_count integer,
  add column cuts_per_second numeric,
  add column avg_shot_s numeric,
  add column min_shot_s numeric,
  add column max_shot_s numeric,
  add column dynamism text check (dynamism in ('mostly_static', 'moderate', 'dynamic'));
