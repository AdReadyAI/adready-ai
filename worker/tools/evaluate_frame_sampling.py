import argparse
import dataclasses
import glob
import json
import os

from analyzer.frame_sampling import FrameSampler
from analyzer.video_preprocessor import VideoPreprocessor


def _reference_paths(folder: str) -> list[str]:
    if not os.path.isdir(folder):
        return []
    return sorted(glob.glob(os.path.join(folder, "*")))


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect frame-sampling probe output for a local video.")
    parser.add_argument("--video", required=True, help="Path to the video file")
    parser.add_argument("--prods", required=True, help="Folder of product reference images")
    parser.add_argument("--logos", required=True, help="Folder of logo reference images")
    parser.add_argument("--work-dir", default="worker/tools/tmp", help="Scratch dir for sampled frame output")
    args = parser.parse_args()

    video_path = args.video
    if not os.path.isfile(video_path):
        raise SystemExit(f"No such video file: {video_path}")

    product_image_paths = _reference_paths(args.prods)
    logo_paths = _reference_paths(args.logos)

    os.makedirs(args.work_dir, exist_ok=True)

    # job_payload is unused by _probe_metadata; only instantiated to reach it
    preprocessor = VideoPreprocessor(job_payload=None, work_dir=args.work_dir)
    metadata = preprocessor._probe_metadata(video_path)

    sampler = FrameSampler(
        video_path,
        metadata,
        args.work_dir,
        product_image_paths=product_image_paths,
        logo_paths=logo_paths,
    )
    frames = sampler.run()

    print(f"metadata: {metadata}")
    print(f"selected frames: {len(frames)}")

    report = {
        "metadata": dataclasses.asdict(metadata),
        "frames": [dataclasses.asdict(frame) for frame in frames],
        "probe_results": {
            name: dataclasses.asdict(result)
            for name, result in sampler.probe_results.items()
        },
    }
    report_path = os.path.join(args.work_dir, "report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nwrote report: {report_path}")


if __name__ == "__main__":
    main()