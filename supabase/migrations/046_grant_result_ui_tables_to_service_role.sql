-- Give service_role write access to the Result UI tables.
--
-- 025 and 026 created issues / result_score_table / result_score_dimensions and
-- granted nothing to anyone. 043 added read access for `authenticated`, which is
-- what the Result UI needs — but service_role was left with only the ambient
-- REFERENCES/TRIGGER/TRUNCATE privileges, no SELECT and no writes.
--
-- Two consequences, both real:
--
--  1. The producers cannot write. score-result upserts result_score_table and
--     inserts result_score_dimensions; process-issues upserts issues. All three
--     go through createSupabaseServiceClient(), so all three fail with
--     permission denied. service_role bypasses RLS, but table GRANTs are a
--     separate system and are checked first.
--
--  2. Supabase Studio's table editor reads through PostgREST as service_role,
--     so these tables render as empty even when they hold rows — which reads as
--     "the seed didn't work" rather than "you cannot see this".
--
-- Mirrors 024 (agent tables) and 037 (quality_frames), which did the same thing
-- for the same reason. Supersedes 042_grant_on_issues_to_service_role.sql on the
-- unmerged issues-edge-function branch: that file covers only `issues`, and if
-- both ever land the grants are idempotent, so the overlap is harmless.

grant select, insert, update, delete on table
  public.issues,
  public.result_score_table,
  public.result_score_dimensions
to service_role;
