import argparse
import glob
import json
import os

from analyzer.frame_sampling.base import ProbeResult
from analyzer.frame_sampling.probes.adaptive import AdaptiveSamplerResult
from analyzer.frame_sampling.probes.quality import QualityFlag, QualityProbeResult
from analyzer.frame_sampling.probes.reference_match import PresenceInterval, ReferenceMatchResult
from analyzer.frame_sampling.probes.scene import SceneProbeResult, Shot
from analyzer.types import Artifacts, Frame, VideoMetadata
from analyzer.video_analyzer import VideoAnalyzer

# One loader per probe name — each probe's ProbeResult subclass has its own
# nested-dataclass shape, so a single generic loader can't reconstruct all of them.
_PROBE_RESULT_LOADERS = {
    "scene": lambda d: SceneProbeResult(
        shots=[Shot(**s) for s in d["shots"]],
        pacing=d["pacing"],
        fades=d["fades"],
    ),
    "adaptive": lambda d: AdaptiveSamplerResult(
        keyframe_count=d["keyframe_count"],
        keyframe_indices=tuple(d["keyframe_indices"]),
    ),
    "quality": lambda d: QualityProbeResult(
        flags=[QualityFlag(**f) for f in d["flags"]],
    ),
    "product": lambda d: ReferenceMatchResult(
        presence_intervals=[PresenceInterval(**p) for p in d["presence_intervals"]],
    ),
    "logo": lambda d: ReferenceMatchResult(
        presence_intervals=[PresenceInterval(**p) for p in d["presence_intervals"]],
    ),
}


def _reference_paths(folder: str | None) -> list[str]:
    if not folder or not os.path.isdir(folder):
        return []
    return sorted(glob.glob(os.path.join(folder, "*")))


def _load_frames(report: dict, tags: list[str] | None) -> list[Frame]:
    frames = [
        Frame(f["index"], f["timestamp"], f["path"], tuple(f["tags"]))
        for f in report["frames"]
    ]
    if tags:
        frames = [f for f in frames if any(tag in f.tags for tag in tags)]
    return frames


def _load_probe_results(report: dict) -> dict[str, ProbeResult]:
    """Reconstruct every probe result present in the report, not just `scene`.

    Tasks only read the probes they care about (today: `context` reads `scene`),
    but loading all of them keeps this generic as more tasks start consuming
    other probes' output, instead of needing a new hardcoded case each time.
    """
    results = {}
    for name, data in report.get("probe_results", {}).items():
        loader = _PROBE_RESULT_LOADERS.get(name)
        results[name] = loader(data) if loader else ProbeResult()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one VideoAnalyzer task against controlled frames.")
    parser.add_argument("--report", required=True, help="Path to a report.json from evaluate_frame_sampling.py")
    parser.add_argument("--task", required=True, help="Task name, e.g. product_detection, logo_detection, context, ocr")
    parser.add_argument("--tags", help="Comma-separated tags; only frames carrying one of these are passed in")
    parser.add_argument("--prods", help="Folder of product reference images (for product_detection)")
    parser.add_argument("--logos", help="Folder of logo reference images (for logo_detection)")
    parser.add_argument("--work-dir", default="tools/tmp", help="Scratch dir for output report")
    args = parser.parse_args()

    with open(args.report) as f:
        report = json.load(f)

    tags = args.tags.split(",") if args.tags else None
    frames = _load_frames(report, tags)
    print(f"passing {len(frames)} frame(s) into '{args.task}'")

    metadata = VideoMetadata(**report["metadata"])
    probe_results = _load_probe_results(report)

    artifacts = Artifacts(
        job_id="local-eval",
        storage_ref="",
        video_path="",
        audio_path=None,
        frames=tuple(frames),
        video_metadata=metadata,
        work_dir=args.work_dir,
        probe_results=probe_results,
        product_image_paths=tuple(_reference_paths(args.prods)),
        logo_paths=tuple(_reference_paths(args.logos)),
    )

    analyzer = VideoAnalyzer(artifacts)
    tasks = analyzer.analysis_tasks()
    if args.task not in tasks:
        raise SystemExit(f"Unknown task '{args.task}'. Available: {sorted(tasks)}")

    result = tasks[args.task]()

    os.makedirs(args.work_dir, exist_ok=True)
    out_path = os.path.join(args.work_dir, f"task_{args.task}.json")
    payload = result.model_dump() if result is not None else None
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2, default=str)

    print(f"\nwrote report: {out_path}")


if __name__ == "__main__":
    main()
