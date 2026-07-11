# AdReady AI local development

This guide sets up AdReady AI entirely on your local machine. The local environment has three
independent parts:

- **Supabase** provides Postgres, Auth, Storage, Studio, and local email testing through Docker.
- **Frontend** is a React application served by Vite on port `5173`.
- **Backend** contains a FastAPI orchestrator and two placeholder worker processes.

The upload and evaluation workflow is still being built. The frontend pages and worker loops are
currently scaffolds, so a successful setup confirms that each development process runs; it does not
yet produce a complete ad evaluation.

## Repository layout

```text
adready-ai/
├── frontend/   # React, TypeScript, and Vite
├── backend/    # FastAPI orchestrator and Python workers
├── supabase/   # Local Supabase configuration
└── docs/       # Project documentation
```

## Prerequisites

Install these tools before cloning the repository:

- [Git](https://git-scm.com/downloads)
- [Node.js 22](https://nodejs.org/en/download)
- [Docker Desktop](https://docs.docker.com/desktop/)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

The project uses npm for the frontend and `uv` for the backend. Do not install the Supabase CLI
globally with npm; Supabase does not support that installation method.

### macOS

1. Install [Homebrew](https://brew.sh/) if it is not already available.
2. Install Node.js 22 and Docker Desktop from the links above.
3. Install Git, `uv`, and the Supabase CLI:

   ```bash
   brew install git uv supabase/tap/supabase
   ```

4. Open Docker Desktop and wait until its engine is running.

### Windows

1. Install Git, Node.js 22, and
   [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Start Docker Desktop using its Linux containers and WSL 2 backend.
3. Install `uv` from PowerShell:

   ```powershell
   winget install --id astral-sh.uv -e
   ```

4. Install [Scoop](https://scoop.sh/), then install the Supabase CLI:

   ```powershell
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   ```

### Linux

1. Install Git, Node.js 22, and Docker Engine or Docker Desktop using your distribution's
   instructions.
2. Install `uv`:

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

3. Install the Supabase CLI using Homebrew for Linux or the package for your distribution from the
   [Supabase CLI releases](https://github.com/supabase/cli/releases).
4. Start the Docker daemon.

### Verify the prerequisites

Open a new terminal and confirm that every command succeeds:

```bash
git --version
node --version
npm --version
docker version
uv --version
supabase --version
```

`node --version` should report version 22. Docker Desktop must be running before `docker version`
can connect to the Docker engine.

## Clone the repository

```bash
git clone https://github.com/AdReadyAI/adready-ai.git
cd adready-ai
```

The rest of this guide uses the repository root as the starting directory unless stated otherwise.

## 1. Start Supabase

Keep Supabase running in its own terminal. From the repository root, run:

```bash
supabase start
```

The first start can take several minutes because Docker must download the local service images.
When startup finishes, inspect the service URLs and development keys with:

```bash
supabase status
```

The main local services are:

| Service | URL |
| --- | --- |
| API | `http://127.0.0.1:54321` |
| Database | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Mailpit | `http://127.0.0.1:54324` |

Local keys and passwords are development credentials only. Never use them in production or expose
the local stack to the public internet.

## 2. Start the frontend

Open a second terminal at the repository root.

### Install dependencies

```bash
cd frontend
npm ci
```

### Configure the local environment

Create a local environment file.

On macOS or Linux:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `frontend/.env` so it contains the local API URL and the `ANON_KEY` printed by
`supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=replace-with-the-local-anon-key
```

Do not commit `frontend/.env`. The repository ignores local environment files.

### Run the frontend

From `frontend/`, run:

```bash
npm run dev
```

Open <http://localhost:5173>. The application throws a clear startup error if either Supabase
environment variable is missing.

## 3. Start the backend

Open a third terminal at the repository root.

### Install Python and dependencies

```bash
cd backend
uv python install 3.12
uv sync --all-extras --group dev
```

`uv` creates and manages `backend/.venv`; you do not need to activate it manually.

### Run the orchestrator

From `backend/`, run:

```bash
uv run adready-orchestrator
```

The API listens on <http://127.0.0.1:8000>. Verify its health endpoint from another terminal:

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

On Windows PowerShell, `Invoke-RestMethod http://127.0.0.1:8000/health` performs the same check.

### Optional worker processes

The media and inference workers are placeholder loops and are not required to view the current
frontend. To confirm their entrypoints, run each command in a separate terminal from `backend/`:

```bash
uv run adready-media-worker
```

```bash
uv run adready-inference-worker
```

Stop either worker with `Ctrl+C`.

## Verify the complete setup

A working local setup has:

- Supabase Studio available at <http://127.0.0.1:54323>.
- The frontend available at <http://localhost:5173>.
- The orchestrator health endpoint returning `{"status":"ok"}`.

The frontend does not yet call the orchestrator, and the workers do not yet claim durable tasks.
These are current implementation boundaries, not setup failures.

## Checks

Run frontend checks from `frontend/`:

```bash
npm run lint
npm run build
```

Run backend checks from `backend/`:

```bash
uv run ruff check .
uv run pyright
uv run pytest
```

## Stop local development

Stop the frontend, orchestrator, and any workers with `Ctrl+C` in their terminals.

From the repository root, stop Supabase with:

```bash
supabase stop
```

This stops and removes the local containers while preserving database data in a Docker volume for
the next `supabase start`.

### Reset local Supabase data

Use the following command only when you intentionally want a blank local database:

```bash
supabase stop --no-backup
```

`--no-backup` permanently deletes the project's local Supabase data volumes. It does not delete the
files under `supabase/`, affect a hosted Supabase project, uninstall the CLI, or remove cached Docker
images.

## Troubleshooting

### Docker is unavailable

If `supabase start` cannot connect to Docker, open Docker Desktop and wait for the engine to finish
starting. Confirm connectivity with `docker version`, then retry.

### Image download reports `Rate exceeded`

The Supabase images are downloaded from a public container registry that can temporarily throttle
requests. Wait briefly and run `supabase start` again. Docker keeps completed layers, so the retry
normally resumes rather than starting over.

### Frontend reports missing Supabase variables

Confirm that `frontend/.env` exists and contains both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. Restart `npm run dev` after changing the file.

### A port is already in use

The local setup expects ports `5173`, `8000`, and `54321` through `54324` to be available. Stop the
conflicting process before restarting the affected service.

### Supabase reports no profile or seed file

Messages about a missing `~/.supabase/profile` or an unmatched `supabase/seed.sql` are currently
informational. Local startup uses the default CLI profile, and this repository does not yet include
a seed file.
