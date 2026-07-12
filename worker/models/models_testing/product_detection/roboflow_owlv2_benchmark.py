
"""
Measure the execution time and credit/dollar cost of Roboflow's OWLv2
image-guided object detection on YOUR images.

Why this script exists
----------------------
Roboflow does NOT publish a per-model price for OWLv2. Cost is derived from
the actual inference time of each request, reported back in the HTTP response
header `x-processing-time`. So the only reliable way to know what OWLv2 will
cost on your images is to run it and read that header.

Roboflow's documented cost formula (docs.roboflow.com/deploy/
serverless-hosted-api-v2/pricing):

    if the `x-remote-processing-time` header is present:
        credits = (100ms + x-remote-processing-time) / 500,000ms
    else:
        credits = max(x-processing-time, 100ms) / 500,000ms

    (1 credit == 500 seconds == 500,000 ms of inference time.)

Dollar cost = credits * (price you pay per credit).
Prepaid credits are ~$4 each; flex/overage credits are ~$6 each (confirm your
plan at roboflow.com/pricing). Free "Public" plan credits are included but
require your data/models to be public.

Two modes
---------
  MODE = "hosted" : calls Roboflow's hosted cloud API, reads the billing
                    headers, and reports exact credits + dollars.

Usage
-----
  pip install requests            # for hosted mode

Command: uv run python models/models_testing/product_detection/roboflow_owlv2_benchmark.py 
"""

import base64
import time
from pathlib import Path

# ----------------------------- CONFIG -------------------------------------- #
MODE = "hosted"
HERE = Path(__file__).parent

ROBOFLOW_API_KEY = "SjyCMyfwbimGMkaEUc6W"

# Your reference product image (the thing you're searching FOR) and the box
# around the product within it. Coordinates are in pixels: x,y = top-left
# corner, w,h = width,height of the box.
REFERENCE_IMAGE = HERE / "product.jpg"
REFERENCE_BOX = {"x": 100, "y": 100, "w": 120, "h": 120, "cls": "product"}

# The target image you want to check ("is the product in here?").
TARGET_IMAGE = HERE / "scene.webp"

# Confidence threshold: only detections at/above this score are returned.
# Start low (e.g. 0.10) while tuning, then raise it once you've seen the scores.
CONFIDENCE = 0.85

# --- Roboflow plan economics (all figures verified at roboflow.com/pricing,
#     and 1 credit = 500 s from docs.roboflow.com/deploy/
#     serverless-hosted-api-v2/pricing) --------------------------------------
# Situation 1: cost of credits INCLUDED in your base plan (blended rate)
#   = BASE_PLAN_MONTHLY_USD / INCLUDED_CREDITS_PER_MONTH
BASE_PLAN_MONTHLY_USD = 79.0        # Core billed annually ($99.0 if monthly)
INCLUDED_CREDITS_PER_MONTH = 15.0   # Core base tier per pricing-page dropdown;
                                    # CONFIRM your real allotment in-app.
# Situation 2: cost of credits BEYOND your plan (marginal/overage rate)
PREPAID_CREDIT_USD = 4.0            # "Additional Prepaid Credits: Starting at $4"
FLEX_CREDIT_USD = 6.0              # "Additional Flex Credits: $6" (auto overage)

SECONDS_PER_CREDIT = 500.0         # v2: 1 credit == 500 s of inference execution
INFERENCES_PER_CREDIT = 1000.0     # v1: 1 credit == 1,000 model inferences

# Hosted OWLv2 endpoint. Confirm the current path in Roboflow's docs if it 404s.
HOSTED_URL = "https://infer.roboflow.com/owlv2/infer"
# --------------------------------------------------------------------------- #


def b64(path: str) -> str:
    """Read an image file and return base64 text (no data-URI prefix)."""
    return base64.b64encode(Path(path).read_bytes()).decode("utf-8")


def credits_v2(processing_time_s: float, remote_time_s: float | None) -> float:
    """v2 billing (per time): 1 credit = 500 s. Times in SECONDS."""
    if remote_time_s is not None:
        billed_ms = 100.0 + remote_time_s * 1000.0
    else:
        billed_ms = max(processing_time_s * 1000.0, 100.0)
    return billed_ms / 500_000.0


def credits_v1() -> float:
    """v1 billing (per inference): flat 1 credit / 1,000 images = 0.001/image."""
    return 1.0 / INFERENCES_PER_CREDIT


def report_cost(processing_time_s: float, remote_time_s: float | None) -> None:
    """Compare v1 vs v2 for one image and pick the cheaper endpoint.

    Assumes INCLUDED_CREDITS_PER_MONTH included credits, then overage."""
    blended = BASE_PLAN_MONTHLY_USD / INCLUDED_CREDITS_PER_MONTH

    c1 = credits_v1()
    c2 = credits_v2(processing_time_s, remote_time_s)
    best, best_c = ("v2", c2) if c2 < c1 else ("v1", c1)

    print("-- per-image credit cost --")
    print(f"  v1 (per-inference, 1cr/1000 img): {c1:.6f} cr/img  (flat)")
    print(f"  v2 (per-second,   1cr/500 s):     {c2:.6f} cr/img  "
          f"(@ {processing_time_s:.3f}s)")
    print(f"  => cheaper endpoint: {best.upper()}  "
          f"(crossover is 0.5 s/image)")

    # What the 15 included credits buy on the best endpoint, per month.
    if best == "v1":
        included_capacity = f"{INCLUDED_CREDITS_PER_MONTH*INFERENCES_PER_CREDIT:.0f} images"
    else:
        secs = INCLUDED_CREDITS_PER_MONTH * SECONDS_PER_CREDIT
        imgs = secs / processing_time_s
        included_capacity = f"{secs:.0f} s (~{imgs:.0f} images at this speed)"

    print(f"\n-- your {INCLUDED_CREDITS_PER_MONTH:.0f} included credits/month "
          f"on {best.upper()} cover --")
    print(f"  {included_capacity}")

    print("\n-- cost per 1,000 images on the best endpoint --")
    per_1k = best_c * 1000
    print(f"  {per_1k:.3f} credits  ->  "
          f"in-plan ${per_1k*blended:.2f} | "
          f"prepaid ${per_1k*PREPAID_CREDIT_USD:.2f} | "
          f"flex ${per_1k*FLEX_CREDIT_USD:.2f}")
    print(f"  (in-plan blended rate = ${blended:.2f}/credit = "
          f"${BASE_PLAN_MONTHLY_USD:.0f}/{INCLUDED_CREDITS_PER_MONTH:.0f}cr; "
          f"prepaid ${PREPAID_CREDIT_USD:.0f}, flex ${FLEX_CREDIT_USD:.0f})")


def as_float(headers, name):
    """Pull a float header if present, else None."""
    v = headers.get(name)
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def run_hosted():
    import requests

    payload = {
        "api_key": ROBOFLOW_API_KEY,
        "image": {"type": "base64", "value": b64(TARGET_IMAGE)},
        "training_data": [
            {
                "image": {"type": "base64", "value": b64(REFERENCE_IMAGE)},
                "boxes": [REFERENCE_BOX],
            }
        ],
        "confidence": CONFIDENCE,
        "visualize_predictions": False,
    }

    t0 = time.perf_counter()
    resp = requests.post(HOSTED_URL, json=payload, timeout=120)
    wall = time.perf_counter() - t0
    resp.raise_for_status()

    h = resp.headers
    proc = as_float(h, "x-processing-time")          # server compute time (s)
    remote = as_float(h, "x-remote-processing-time")  # set for some routes
    cold = h.get("x-model-cold-start", "false").lower() == "true"
    load = as_float(h, "x-model-load-time")           # cold-start load time (s)

    # Fall back to wall-clock if the header is missing for any reason.
    proc_for_cost = proc if proc is not None else wall

    data = resp.json()
    preds = data.get("predictions", data)

    print("\n=== Roboflow OWLv2 (hosted) ===")
    print(f"cold start:            {cold}"
          + (f"  (model load {load:.3f}s)" if cold and load else ""))
    print(f"x-processing-time:     {proc if proc is not None else 'n/a'} s")
    if remote is not None:
        print(f"x-remote-processing:   {remote} s")
    print(f"round-trip (wall):     {wall:.3f} s\n")
    report_cost(proc_for_cost, remote)
    print(f"\ndetections at conf>={CONFIDENCE}:")
    if isinstance(preds, list) and preds:
        for p in preds:
            print(f"  - {p}")
        print(f"\n=> PRODUCT PRESENT: YES ({len(preds)} detection(s))")
    else:
        print("  (none)")
        print("\n=> PRODUCT PRESENT: NO")
    print("\nNote: ignore the cold-start request when estimating steady-state "
          "cost/latency; run a few times and use a warm one.")


if __name__ == "__main__":
    if MODE == "hosted":
        if ROBOFLOW_API_KEY == "YOUR_API_KEY_HERE":
            raise SystemExit("Set ROBOFLOW_API_KEY first (get one at "
                             "app.roboflow.com > settings > API keys).")
        run_hosted()
    else:
        raise SystemExit('MODE must be "hosted" or "local".')