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

- **2026-08-09** — Split the advanced brief fields into required and optional in
  `AdvancedFieldsSection`. The four required ones (Brand Voice, Target Audience,
  Required Messages, Brand Guidelines) each gate a sub-check that the
  brief/brand alignment agents force to `cannot_assess` when the input is blank;
  submit is now blocked on them via the exported `missingRequiredAdvanced`. The
  other four are prompt context only, so they stay optional.
- **2026-08-09** — Fixed the red `main` build. Adding required `videoPath` /
  `timestampSeconds` to `VideoResult` / `Issue` broke three older test fixtures
  that still built those objects the old way. Only the CI `quality` job caught
  it: vitest transpiles through esbuild, which strips types without checking
  them, so `npm run test:unit` stayed green while `tsc -b` failed. Widening a
  shared type means every fixture that constructs it, tests included.
- **2026-08-09** — Expanded issue rows play the real video instead of a fake
  black box. `components/results/IssueClip.tsx` is an ordinary player (native
  `controls` — play/pause, scrub, volume, fullscreen) that opens parked on the
  issue's frame, clamped to the clip's duration since nothing guarantees
  `video_timestamp` falls inside the video. `Issue` gains `timestampSeconds`
  (same parser as the display label, so the chip and the seek cannot drift) and
  `VideoResult` gains `videoPath`; `lib/useSignedVideoUrl.ts` signs one URL per
  selected video from the private `uploads` bucket and drops out-of-order
  responses, which would otherwise pair a clip with the wrong video. Note the
  fallback is silent: an unplayable file (HEVC, which Chrome cannot decode and
  iPhones record by default) shows the static frame with no explanation.
- **2026-08-07** — Uploads are capped at 100 MB per file (`MAX_UPLOAD_BYTES` in
  `pages/UploadPage.tsx`); oversized files land on the grid as errors and are
  never sent. Client-side only — the enforcing limits are in
  `supabase/config.toml` and the `uploads` bucket, smallest wins. Note the card
  shows a bare `!` with no reason; surfacing *why* an upload failed is still open.
- **2026-08-06** — **Export Report** on ResultPage now downloads a PDF of the
  whole batch instead of a JSON dump; the JSON export is gone. The document
  (`components/results/ReportDocument.tsx`, built with `@react-pdf/renderer`) is a
  cover page with the ranking, then one page per video carrying its scorecard and
  full issue list. It is **only ever loaded through the dynamic `import()` in
  `lib/downloadReport.ts`** — that keeps ~1.4MB out of the main bundle, so nothing
  may import it statically. Anything the export and the screen both say now lives
  in `lib/reportModel.ts` (filename, empty-issue copy gated on status, `scoreText`
  so a null score never prints as 0) and colours come from new `pdf` hex fields on
  `status.ts`, so the two cannot drift. The button shows a pending state while the
  chunk downloads and reports failures beside itself rather than replacing the
  results.
- **2026-08-05** — ResultPage now renders live data and the mock is gone. Route
  is `/result/:batchId` (refreshable and shareable; `CampaignForm` navigates
  there), progress is real — a video appears once it has a score row, polling
  every 4s until the batch completes with a 5min cutoff. `status.ts` gains the
  grey `unassessed` state and a `SEVERITY_STYLE` map; `IssueRow` no longer paints
  `critical` the same amber as `medium`; `MetricBar` shows an unassessed
  dimension as a dashed track and a dash, never a 0% bar; `RankCard` withholds
  the green winner badge from an unscored video. The "ready to ship" empty state
  is now gated on status, not issue count — filtered severities mean an empty
  list no longer proves a creative is clean. Metric labels widened for the
  longer database dimension names. The loading view is a deliberate placeholder
  ("N of M scored") — real per-stage progress is a separate task, so this only
  polls for the pipeline's last stage.
- **2026-08-05** — Added the Result UI data layer. `lib/resultsTransform.ts` is
  pure (rows -> `VideoResult[]`: severity filtering, both sort orders, timestamp
  normalization, derived summaries) and `lib/results.ts` does the four queries.
  Split so the transforms are testable without env vars or a database — 30 unit
  tests in `resultsTransform.test.ts`. Note `result_score_dimensions` has no
  `batch_id`, so it filters on request ids while the others filter on the batch.
- **2026-08-05** — `types/results.ts` rewritten against the database's CHECK
  constraints ahead of wiring ResultPage to real data. `ShipStatus` gains
  `unassessed` (`Cannot Assess`), `Severity` covers all six values migration 025
  allows, and the new `DisplaySeverity` excludes `none`/`cannot_assess` so the
  compiler stops a filtered severity reaching a component. `score`, `Metric.value`,
  and the nullable `Issue` fields are now `| null` — null is not zero. Presentation
  fields (`severityLabel`, `frameLabel`, `repairTitle`) and `tag` are gone; `tag`
  becomes `metricId`. Types-only change: `IssueRow`, `status.ts`, and `ResultPage`
  don't compile until the components are updated.
- **2026-08-02** — Both writes in `CampaignForm`'s submit are now idempotent, so
  retrying after a failed brief save can't duplicate a batch. `request_id` is
  minted client-side and the `requests` write is an upsert with
  `ignoreDuplicates`, so a retry no-ops on conflict instead of fanning out a
  second set of rows — and a second pipeline run per video via
  `trg_enqueue_job_on_request_insert`. Migration
  `036_require_client_minted_request_id.sql` drops the `gen_random_uuid()`
  default on `requests.request_id` so an insert that omits it fails loudly
  rather than silently losing retry-safety.
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
