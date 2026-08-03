"""Batch-check OWLv2 detections: reference images vs frames from a report.json.

Usage:
    uv run python -m tools.run_reference_detector \\
        --refs data/prod --report tools/tmp/report.json --tags product --label product --out-dir tools/tmp/detections
"""

import argparse
import glob
import json
import os

from PIL import Image, ImageDraw

from analyzer.object_detector import Detection, ReferenceDetector, _padded_reference


def _paths(folder: str) -> list[str]:
    return sorted(glob.glob(os.path.join(folder, "*")))


def _save_padded_refs(ref_paths: list[str], out_dir: str) -> None:
    """Save what actually gets sent to OWLv2: the padded crop + its training box."""
    os.makedirs(out_dir, exist_ok=True)
    for path in ref_paths:
        with Image.open(path) as image:
            padded, (cx, cy, w, h) = _padded_reference(image)
        draw = ImageDraw.Draw(padded)
        box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        draw.rectangle(box, outline="lime", width=3)
        out_path = os.path.join(out_dir, os.path.basename(path))
        padded.save(out_path)
        print(f"saved padded reference: {out_path}")


def _target_paths(report_path: str, tags: list[str] | None) -> list[str]:
    with open(report_path) as f:
        report = json.load(f)
    frames = report["frames"]
    if tags:
        frames = [f for f in frames if any(tag in f["tags"] for tag in tags)]
    return [f["path"] for f in frames]


def _draw_detections(target: str, detections: list[Detection], out_dir: str) -> str:
    """Convert each Detection's normalized center-box back to pixels and draw it."""
    with Image.open(target) as image:
        image = image.convert("RGB")
        width, height = image.size
        draw = ImageDraw.Draw(image)
        for detection in detections:
            cx, cy, w, h = detection.x * width, detection.y * height, detection.w * width, detection.h * height
            box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            draw.rectangle(box, outline="red", width=3)
            draw.text((box[0], max(box[1] - 12, 0)), f"{detection.confidence:.2f}", fill="red")

        out_path = os.path.join(out_dir, os.path.basename(target))
        image.save(out_path)
        return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ReferenceDetector against frames listed in a report.json.")
    parser.add_argument("--refs", required=True, help="Folder of reference images (product or logo)")
    parser.add_argument("--report", required=True, help="Path to a report.json from evaluate_frame_sampling.py")
    parser.add_argument("--tags", help="Comma-separated tags; only frames carrying one of these are tested")
    parser.add_argument("--label", default="product", help="Class label, e.g. product or logo")
    parser.add_argument("--confidence", type=float, default=0.1)
    parser.add_argument("--out-dir", default="tools/tmp/detections", help="Where to save annotated hits")
    parser.add_argument("--save-refs-dir", help="If set, also save the padded reference images actually sent to OWLv2")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    ref_paths = _paths(args.refs)
    if args.save_refs_dir:
        _save_padded_refs(ref_paths, args.save_refs_dir)

    detector = ReferenceDetector(ref_paths, label=args.label)

    tags = args.tags.split(",") if args.tags else None
    targets = _target_paths(args.report, tags)
    print(f"testing {len(targets)} frame(s) from '{args.report}'")

    for target in targets:
        detections = detector.detect_all(target, confidence=args.confidence)
        if not detections:
            print(f"{os.path.basename(target)}: no detection")
        else:
            out_path = _draw_detections(target, detections, args.out_dir)
            print(f"{os.path.basename(target)}: {len(detections)} detection(s) -> {out_path}")
            for d in detections:
                print(f"    conf={d.confidence:.3f} x={d.x:.3f} y={d.y:.3f} w={d.w:.3f} h={d.h:.3f}")


if __name__ == "__main__":
    main()
