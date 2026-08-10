import math
from contextlib import contextmanager

from psycopg2.extras import Json
from pydantic import BaseModel

from analyzer.frame_sampling.probes.quality import QualityFlag
from analyzer.frame_sampling.probes.scene import SceneProbeResult
from analyzer.output_models import TaskResult
from analyzer.types import VideoMetadata


def _adapt(value):
    if isinstance(value, BaseModel):
        return Json(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return Json(value)
    return value


def _aspect_ratio(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return "unknown"
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


class Supabase:
    def __init__(self, cur, request_id: str):
        self.cur = cur
        self.conn = cur.connection
        self.request_id = request_id

    @contextmanager
    def transaction(self):
        previous = self.conn.autocommit
        self.conn.autocommit = False
        try:
            yield self.cur
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        finally:
            self.conn.autocommit = previous

    def persist_results(self, results: dict[str, TaskResult], errors: dict[str, str]) -> None:
        for name, result in results.items():
            table = type(result).table
            with self.transaction():
                processing_id = self._upsert_processing(name, "success", table)
                self._replace_rows(table, processing_id, result.rows)

        for name, error in errors.items():
            self._upsert_processing(name, "error", None, error)

    def mark_processing(self, task_name: str) -> None:
        self._upsert_processing(task_name, "processing", None)

    def mark_media_processing_started(self) -> None:
        self._set_media_processing_status("processing")

    def mark_media_processing_completed(self) -> None:
        self._set_media_processing_status("completed")

    def mark_media_processing_failed(self, error: str) -> None:
        self._set_media_processing_status("failed", error)

    def record_media_processing_error(self, error: str) -> None:
        """Persist the latest failure reason without ending the retry cycle."""
        self.cur.execute(
            "UPDATE requests SET media_processing_error = %s WHERE request_id = %s;",
            (error, self.request_id),
        )

    def mark_media_processing_exhausted(self) -> None:
        """Flip status to failed once retries end, keeping the last recorded error."""
        self.cur.execute(
            "UPDATE requests SET media_processing_status = 'failed' WHERE request_id = %s;",
            (self.request_id,),
        )

    def _set_media_processing_status(self, status: str, error: str | None = None) -> None:
        self.cur.execute(
            "UPDATE requests SET media_processing_status = %s, media_processing_error = %s "
            "WHERE request_id = %s;",
            (status, error, self.request_id),
        )

    def persist_quality_frames(self, flags: list[QualityFlag]) -> None:
        """Replace this request's flagged-frame evidence (delete + reinsert,
        same as _replace_rows) so a retried job doesn't duplicate rows —
        preprocessing has no completed-work checkpoint, so it reruns in full.
        """
        with self.transaction():
            self.cur.execute(
                "DELETE FROM quality_frames WHERE request_id = %s;",
                (self.request_id,),
            )
            if not flags:
                return

            values = [
                (
                    self.request_id,
                    f"q_{flag.index:06d}",
                    round(flag.timestamp * 1000),
                    list(flag.reasons),
                    flag.scores.get("sharpness"),
                    flag.scores.get("crushed_frac"),
                    flag.scores.get("blown_frac"),
                    flag.scores.get("mean_luma"),
                    flag.scores.get("contrast"),
                    flag.scores.get("grain"),
                    flag.scores.get("blockiness"),
                    flag.scores.get("temporal_delta"),
                )
                for flag in flags
            ]
            self.cur.executemany(
                """
                INSERT INTO quality_frames (
                    request_id, frame_id, timestamp_ms, reasons,
                    sharpness, crushed_frac, blown_frac, mean_luma,
                    contrast, grain, blockiness, temporal_delta
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                values,
            )

    def persist_video_metadata(
        self, metadata: VideoMetadata, scene_result: SceneProbeResult | None
    ) -> None:
        """Upsert (not insert) this request's video_metadata row: a retried/
        redelivered job reruns preprocessing in full and must overwrite the
        previous row rather than fail or duplicate it.
        """
        pacing = scene_result.pacing if scene_result else {}
        with self.transaction():
            self.cur.execute(
                """
                INSERT INTO video_metadata (
                    request_id, duration_ms, aspect_ratio, resolution,
                    shot_count, cuts_per_second, avg_shot_s, min_shot_s, max_shot_s,
                    dynamism, fps
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (request_id) DO UPDATE SET
                    duration_ms = EXCLUDED.duration_ms,
                    aspect_ratio = EXCLUDED.aspect_ratio,
                    resolution = EXCLUDED.resolution,
                    shot_count = EXCLUDED.shot_count,
                    cuts_per_second = EXCLUDED.cuts_per_second,
                    avg_shot_s = EXCLUDED.avg_shot_s,
                    min_shot_s = EXCLUDED.min_shot_s,
                    max_shot_s = EXCLUDED.max_shot_s,
                    dynamism = EXCLUDED.dynamism,
                    fps = EXCLUDED.fps;
                """,
                (
                    self.request_id,
                    round(metadata.duration_s * 1000),
                    _aspect_ratio(metadata.width, metadata.height),
                    f"{metadata.width}x{metadata.height}",
                    pacing.get("shot_count"),
                    pacing.get("cuts_per_second"),
                    pacing.get("avg_shot_s"),
                    pacing.get("min_shot_s"),
                    pacing.get("max_shot_s"),
                    scene_result.dynamism if scene_result else None,
                    metadata.fps,
                ),
            )

    def completed_analyzers(self) -> set[str]:
        self.cur.execute(
            "SELECT task_name FROM video_processing "
            "WHERE request_id = %s AND status = 'success';",
            (self.request_id,),
        )
        return {row[0] for row in self.cur.fetchall()}

    def _upsert_processing(self, task_name, status, result_table, error=None) -> str:
        self.cur.execute(
            """
            INSERT INTO video_processing (request_id, task_name, status, result_table, error, updated_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (request_id, task_name)
            DO UPDATE SET status       = EXCLUDED.status,
                        result_table = EXCLUDED.result_table,
                        error        = EXCLUDED.error,
                        updated_at   = now()
            RETURNING id;
            """,
            (self.request_id, task_name, status, result_table, error),
        )
        return self.cur.fetchone()[0]


    def _replace_rows(self, table, processing_id, rows) -> None:
        self.cur.execute(f"DELETE FROM {table} WHERE processing_id = %s;", (processing_id,))
        if not rows:
            return

        columns = list(type(rows[0]).model_fields.keys())
        all_columns = ["processing_id", *columns]
        placeholders = "(" + ", ".join(["%s"] * len(all_columns)) + ")"
        values = [
            (processing_id, *(_adapt(getattr(row, c)) for c in columns))
            for row in rows
        ]
        self.cur.executemany(
            f'INSERT INTO {table} ({", ".join(all_columns)}) VALUES {placeholders};',
            values,
        )
