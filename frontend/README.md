# Frontend

The React SPA for AdReady AI — see the [repo root README](../README.md) for the
full system architecture (frontend + Supabase + worker). This doc covers the
frontend specifically: what it's responsible for, how its data model works,
and what's real vs. still mocked. **Update this doc as part of any PR that
changes frontend behavior, routes, or the request/batch data model** — it's
meant to stay current for the whole team, not a one-time snapshot.

## What this app does

A signed-in user uploads one or more ad videos plus product images/logos,
fills in a creative brief, and submits them for AI review. The SPA is
responsible for: auth, uploads to Supabase Storage, submitting the review
request, and (eventually) showing live processing status and results.

Routes (`src/App.tsx`):

| Path | Page | Auth |
| --- | --- | --- |
| `/auth/signin`, `/auth/signup` | `pages/auth/*` | public |
| `/upload` | `pages/UploadPage.tsx` | protected |
| `/result` | `pages/ResultPage.tsx` | protected |

## Structure

```text
src/
|- pages/              # route-level components (UploadPage, ResultPage, auth/*)
|- components/
|  |- upload/           # dropzone, media cards, campaign form
|  |- results/          # rank card, metric bar, issue row
|  |- layout/, auth/    # app chrome, ProtectedRoute
|- contexts/            # AuthContext (Supabase session)
|- lib/                 # supabaseClient, auth helpers
|- mocks/               # fixture data for ResultPage until it's wired to real data
`- types/
```

## Request / batch data model

One upload submission can contain N videos, but the processing pipeline
(`worker/`, `supabase/migrations/008_create_video_processing.sql`) expects
**one `requests` row per video** — `video_processing` is keyed
`UNIQUE(request_id, task_name)`, and `JobPayload.video_path` (see
`worker/app/schemas.py`) is a single path, not an array. So the frontend fans
out at submit time instead of sending one row with an array of videos:

- `UploadPage.tsx` generates a `batchId` (`crypto.randomUUID()`) once per
  upload session. It scopes every Storage path for that session
  (`{user}/{batchId}/video/{id}/...`) and is passed down to `CampaignForm`.
- `CampaignForm.tsx`'s submit handler inserts **one `requests` row per
  video**, each row carrying the shared brief/product URL/campaign
  goal/`product_image_paths`/`logo_paths`, but only that video's path in
  `video_storage_paths`. Each row gets its own `request_id` from the
  column's `default gen_random_uuid()` (`supabase/migrations/007_create_requests_table.sql`)
  — nothing sets it explicitly.
- Every row in the batch shares the same `batch_id`
  (`supabase/migrations/022_add_batch_id.sql`, column order:
  `request_id, batch_id, user_id, ...`), which is how the loading/results UI
  will group them back together (query `requests WHERE batch_id = ...`)
  instead of relying on React Router navigation state, which doesn't survive
  a refresh.

So: `request_id` = one video = one worker job. `batch_id` = one user
submission = however many videos they uploaded together.

## Current status

Real: auth (email/password + Google), upload to Storage, `requests` row
creation (fanned out per video, per above), and enqueueing — a DB trigger
(`supabase/migrations/023_enqueue_on_request_insert.sql`,
`trg_enqueue_job_on_request_insert`) fires `enqueue_job()` automatically for
every `requests` row inserted, building the `JobPayload` from that row and
sending it to `pgmq`. Runs inside the same transaction as the insert, so a
failed enqueue rolls the request insert back too. The frontend itself never
calls `enqueue_job()` directly.

Still mocked / not wired:
- `ResultPage.tsx` renders entirely from `mocks/results.ts`; there's no
  processing/loading view driven by real status (the old fake-progress
  `LoadingPage` was deleted as dead code, not replaced yet).
- "Use existing campaign" mode in `CampaignForm` selects from a hardcoded
  list and never touches Supabase.

## Dev commands

Run from `frontend/` (see root README for first-time env setup):

```bash
npm run dev          # local dev server
npm run lint          # oxlint
npm run build          # tsc -b && vite build
npm run test:unit      # vitest
npm run test:integration  # playwright
```

## Changelog

Newest first. Keep entries short — one or two lines on what changed and why,
not a full diff.

- **2026-07-30** — `CampaignForm` now parses the creative brief on blur via
  `supabase/functions/parse-creative-brief` edge function, auto-populates the
  new `AdvancedFieldsSection` component with AI-filled field badges and
  undo controls, and persists one `parsed_creative_briefs` row per batch on
  submit (with the `destination_platform` dropdown). Migration
  `024_rekey_parsed_creative_briefs_to_batch.sql` rekeys the table on
  `batch_id` and adds missing grants/INSERT policy.
- **2026-07-27** — Renamed this branch's `011_add_batch_id.sql`/
  `012_enqueue_on_request_insert.sql` to `022_*`/`023_*` — `main` had
  independently claimed `011`–`021` for its own tables while this branch
  was unmerged, so the numbers collided.
- **2026-07-22** — `supabase/migrations/012_enqueue_on_request_insert.sql`
  adds a DB trigger that calls `enqueue_job()` automatically on every
  `requests` insert. This was the last Phase 1 blocker (see the pipeline
  handoff notes) — submitting a campaign now actually reaches the worker
  queue.
- **2026-07-22** — `supabase/migrations/011_add_batch_id.sql` rebuilds
  `requests` (drop + recreate, no data to migrate yet) so `batch_id` sits
  right after `request_id` instead of at the end.
- **2026-07-22** — `CampaignForm` now inserts one `requests` row per video
  (was one row with an array of video paths) and adds `batch_id` to group
  them, aligning with the pipeline's one-video-per-`request_id` contract.
  `JobPayload` (`worker/app/schemas.py`) updated to take
  `product_image_paths`/`logo_paths` arrays instead of a single
  `product_imgs_folder_path` string, confirmed with the pipeline team.
