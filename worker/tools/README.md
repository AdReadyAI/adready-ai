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
  --video /app/tools/data/test.MP4 \
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

## 4. Visualize selected frames by tag

Save a contact-sheet grid of frames carrying a given tag (e.g. `product`, `logo`) as a PNG.

```bash
docker compose exec worker uv run python -c "
from tools.visualize_frames import plot_frames_by_tag
plot_frames_by_tag(artifact.frames, 'product', save_path='tools/tmp/product_frames.png')
"
```

Or from a debug console at a breakpoint where `artifact` is in scope:

```python
from tools.visualize_frames import plot_frames_by_tag
plot_frames_by_tag(artifact.frames, 'product', save_path='tools/tmp/product_frames.png')
```

## 5. Run a single analysis task in isolation

Run one `VideoAnalyzer` task (e.g. `product_detection`, `logo_detection`, `context`, `ocr`) against
hand-picked frames from a `report.json`, without touching Supabase or the queue.

```bash
docker compose exec worker \
  uv run python -m tools.evaluate_task \
  --report tools/tmp/report.json \
  --task product_detection \
  --tags product \
  --prods tools/data/prod
```

- `--tags` (optional): only test frames carrying these tags, regardless of how they were originally sampled.
- `--logos`: reference folder for `logo_detection`.
- Output: `tools/tmp/task_<task>.json`.

## 6. Batch-test OWLv2 detection against a reference set

Run `ReferenceDetector` directly against every frame in a `report.json`, drawing all detections
(not just the best match) and optionally saving the padded reference images actually sent to OWLv2.

```bash
docker compose exec worker \
  uv run python -m tools.run_reference_detector \
  --refs tools/data/prod \
  --report tools/tmp/report.json \
  --tags product \
  --label product \
  --confidence 0.7 \
  --save-refs-dir tools/tmp/refs_sent
```

- `--out-dir` (default `tools/tmp/detections`): annotated frames for every detection found.
- `--save-refs-dir` (optional): dumps the padded reference crop + training box for visual sanity-checking.

