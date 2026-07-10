# AdReady AI

AdReady AI is an application for evaluating video ads before launch. A user can upload an ad,
submit it for review, follow its progress, and inspect the final launch-readiness scorecard.

The repository currently provides the application shell and local infrastructure for that flow.
The frontend pages and AI processing handler are still placeholders, so the project does not yet
produce a complete ad evaluation.

## Architecture

The React SPA is the product interface. Supabase is the trusted backend platform and workflow
control plane. Railway runs the Python media-processing worker.

```text
React frontend
      |
      | trusted reads, subscriptions, and Edge Function calls
      v
Supabase
  |- Auth, RLS, Postgres, and Storage
  |- Edge Functions and durable queues
  `- workflow orchestration
          |                 ^
          | media job       | evidence and step completion
          v                 |
    Railway Python worker
```

- **React SPA:** handles authentication, uploads, review submission, progress monitoring, and
  result presentation. It reads permitted data directly under row-level security (RLS), subscribes
  to workflow updates, and invokes trusted Edge Functions for mutations.
- **Supabase:** authenticates and authorizes users, persists application and workflow state, stores
  media and generated artifacts, delivers background jobs, and advances reviews through Edge
  Functions.
- **Railway worker:** runs the long-lived Python process responsible for transcription, OCR, frame
  extraction, scene segmentation, and other Python-native media preprocessing.

## Review workflow

1. The user authenticates and uploads an ad through the React SPA.
2. The SPA invokes a trusted Edge Function such as `submit-review`.
3. The function authenticates and authorizes the user, validates the request, creates the review
   and workflow records, initializes the workflow state, and enqueues a media-processing job.
4. The Railway worker claims the job, downloads the source media, performs the required media
   processing, and uploads larger generated artifacts to Supabase Storage.
5. The worker persists an `EvidenceBundle` describing transcripts, frames, OCR output, scene data,
   and other generated evidence. It marks the media-processing step complete and signals the
   orchestration Edge Function.
6. The orchestrator reads the durable workflow state, determines which steps are eligible, and
   atomically claims them to prevent duplicate dispatch.
7. The orchestrator runs grounding, fans out independent evaluators when grounding completes, and
   dispatches final scoring and synthesis after all required evaluators finish.
8. The SPA observes status changes and reads the completed results under RLS.

Postgres is the system of record for reviews, workflow runs, workflow steps, evidence metadata,
evaluator outputs, and final results. Storage contains uploaded videos and larger generated files.
Queues provide durable background-work delivery, while Edge Functions own trusted state changes,
grounding, evaluation, orchestration, and finalization.

## Implementation status

The architecture above is the target system design. This repository currently implements only an
early subset of it.

Currently implemented:

- Frontend routing and shared layout for upload, loading, and result pages
- Supabase browser-client configuration
- Local Supabase configuration and database migrations
- Initial PGMQ job creation and enqueue function
- Containerized Python worker with retries and graceful shutdown
- Component CI/CD pipelines with executable frontend and worker test foundations

Not yet implemented:

- Authentication screens, authorization policies, and user flow
- Video upload and Storage policies
- Review, workflow, evidence, evaluator, and result schemas
- Trusted submission, retry, and cancellation Edge Functions
- Orchestration, grounding, evaluator, and finalization Edge Functions
- Frontend submission, subscriptions, and progress tracking
- Python-native media processing and `EvidenceBundle` persistence
- Final result rendering
- Comprehensive domain, authorization, workflow, and media-processing test coverage

## Repository layout

```text
adready-ai/
|- frontend/       # React and TypeScript web application
|- worker/         # Railway media worker and processing entry point
|- supabase/       # Local Supabase configuration and migrations
|- docs/           # Additional project documentation
`- docker-compose.yml
```

## Prerequisites

Install the following tools:

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download)
- [Docker Desktop](https://docs.docker.com/desktop/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

The frontend uses npm. The worker runs in Docker and uses `uv` inside its image, so a local Python
installation is not required for the standard setup.

Confirm that the prerequisites are available:

```bash
git --version
node --version
npm --version
docker version
supabase --version
```

Docker must be running before starting Supabase or the worker.

## Local development

Clone the repository and enter its root directory:

```bash
git clone https://github.com/AdReadyAI/adready-ai.git
cd adready-ai
```

Run each part of the application in a separate terminal.

### 1. Start Supabase

From the repository root:

```bash
supabase start
```

The first start may take several minutes while Docker downloads the required images. When startup
finishes, display the local service URLs and development keys:

```bash
supabase status
```

The primary local services are:

| Service | URL |
| --- | --- |
| API | `http://127.0.0.1:54321` |
| Database | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |

The current migrations create an initial `jobs` queue and enqueue function. These are scaffolding
for the more specialized durable workflow described above.

### 2. Start the frontend

From a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env
```

On Windows PowerShell, create the environment file with:

```powershell
Copy-Item .env.example .env
```

Update `frontend/.env` with the `ANON_KEY` shown by `supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-the-local-anon-key
```

Start Vite:

```bash
npm run dev
```

Open <http://localhost:5173>. The current routes are `/upload`, `/loading`, and `/result`; each page
is a placeholder for its corresponding stage of the evaluation flow.

### 3. Start the media worker

After Supabase is running, start the worker from a third terminal at the repository root:

```bash
docker compose up --build worker
```

This container represents the media-processing service that will run continuously on Railway in a
deployed environment. Locally, it connects to Supabase Postgres, listens for jobs, and passes each
payload to `worker/handler.py`. The current handler only logs the payload; it does not yet process
media, persist an `EvidenceBundle`, or signal an orchestration Edge Function.

To exercise the worker manually, enqueue a JSON payload through Supabase Studio or a database
client:

```sql
SELECT pgmq.send('jobs', '{"user_id": "test-user", "prompt": "hello"}');
```

## Development checks

### Frontend

Run quality and unit checks from `frontend/`:

```bash
npm run lint
npm run build
npm run test:unit
```

Install Chromium once, then run browser integration tests:

```bash
npx playwright install chromium
npm run test:integration
```

Place Vitest unit and component tests beside their source as `src/**/*.test.tsx`. Place Playwright
browser tests under `frontend/tests/integration/`.

### Python worker

Install the development dependencies and run the isolated unit suite from `worker/`:

```bash
uv sync --frozen
uv run pytest -m unit
```

Worker integration tests expect the local Supabase database and migrations to be available:

```bash
supabase db start
supabase db reset --local --no-seed
cd worker
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  uv run pytest -m integration
```

Place worker tests under `worker/tests/unit/` or `worker/tests/integration/` and mark them with the
matching strict pytest marker.

### Supabase Edge Functions

Edge Functions use Deno's built-in formatter, linter, and test runner:

```bash
deno fmt --config supabase/deno.json --check
deno lint --config supabase/deno.json
deno task --config supabase/deno.json test:unit
supabase start
deno task --config supabase/deno.json test:integration
```

The files under `supabase/tests/functions/` are ignored templates until the first Edge Functions
are implemented. Unit tests should exercise pure validation and workflow logic without services.
Integration tests should invoke locally served functions and verify Auth, RLS, database, Storage,
queue, and workflow effects.

## CI/CD

GitHub Actions runs component-specific pipelines. Pull requests validate only the components they
change, and superseded CI runs are cancelled automatically.

- **Frontend CI:** runs quality/build checks, Vitest unit tests, and Playwright integration tests as
  independent jobs.
- **Worker CI:** compiles the worker, runs isolated pytest unit tests, verifies the live queue
  contract against local Supabase, and builds the same Dockerfile used by Railway.
- **Supabase CI:** replays and lints migrations, runs Deno Edge Function unit checks, and runs Edge
  Function integration tests against a complete ephemeral local stack.

Pushes to `main` deploy a changed component only after its CI job succeeds:

- Worker changes deploy the `worker/` directory to Railway.
- Supabase changes preview pending production migrations with `db push --dry-run`, apply the
  migrations, and then deploy Edge Functions when `supabase/functions/` exists.

Both deployment jobs use the GitHub `production` environment and serialize changes to each
platform. They can also be run manually through `workflow_dispatch`.

### GitHub production environment

Create a GitHub Actions environment named `production`, restrict it to the `main` branch, and add
the following environment configuration:

| Type | Name | Purpose |
| --- | --- | --- |
| Secret | `RAILWAY_TOKEN` | Project-scoped Railway token for the production environment |
| Variable | `RAILWAY_SERVICE` | Railway service name or ID for the media worker |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase personal access token used by the CLI |
| Secret | `SUPABASE_DB_PASSWORD` | Production project's database password |
| Variable | `SUPABASE_PROJECT_REF` | Production Supabase project reference |

Configure a required reviewer for the `production` environment when the repository's GitHub plan
supports deployment protection rules. Pull-request workflows do not receive these production
credentials and validate migrations only against an ephemeral local database.

## Stop local development

Stop Vite and the foreground worker with `Ctrl+C`. If the worker is running in the background, stop
it from the repository root with:

```bash
docker compose down
```

Stop Supabase while preserving local database data:

```bash
supabase stop
```

To intentionally delete the project's local Supabase data:

```bash
supabase stop --no-backup
```

## Troubleshooting

### Docker is unavailable

Open Docker Desktop and wait for its engine to start. Confirm connectivity with `docker version`,
then retry the failed command.

### Frontend reports missing Supabase variables

Confirm that `frontend/.env` contains both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Restart
the Vite development server after editing the file.

### Worker cannot connect to Postgres

Start Supabase before the worker and confirm that its database is available on port `54322` with
`supabase status`. The Compose configuration connects through `host.docker.internal`.

### A port is already in use

The default setup uses port `5173` for Vite and ports `54321` through `54323` for the primary local
Supabase services. Stop the conflicting process before restarting the affected service.

## Contributing

See [CONTRIBUTING](CONTRIBUTING) for the repository's contribution guidelines.
