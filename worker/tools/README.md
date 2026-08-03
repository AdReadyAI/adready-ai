# Frame-sampling preprocessing evaluator

Inspect what each probe selects during frame sampling for a given video.

## 1. Start the worker container

```bash
docker compose up -d --build worker
```

## 2. Run the analysis

```bash
docker compose exec worker \
  uv run python -m tools.evaluate_frame_sampling \
  --video /app/tools/data/<your-video> \
  --prods /app/tools/data/prod \
  --logos /app/tools/data/logo \
  --work-dir /app/tools/tmp
```

## 3. Browse results in the notebook

```bash
docker compose exec worker \
  uv run jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root \
  --ServerApp.iopub_data_rate_limit=10000000
```

Open the printed `http://127.0.0.1:8888/lab?token=...` URL, then open
`tools/inspect_results.ipynb`.

