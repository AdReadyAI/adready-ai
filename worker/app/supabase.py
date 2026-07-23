from contextlib import contextmanager

from analyzer.output_models import TaskResult
from .errors import PermanentError

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

    def completed_analyzers(self) -> set[str]:
        self.cur.execute(
            "SELECT task_name FROM video_processing "
            "WHERE request_id = %s AND status = 'success';",
            (self.request_id,),
        )
        return {row[0] for row in self.cur.fetchall()}

    def create_or_resume_ocr_run(self, payload) -> str:
        """Create the caller-identified OCR Run or resume its durable state."""

        with self.transaction():
            # Ad Creative identity is stable: a repeated identifier may not be
            # rebound to another Review Request or Storage object.
            self.cur.execute(
                """
                INSERT INTO ad_creatives (
                    ad_creative_id, request_id, source_bucket, source_path
                )
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (ad_creative_id) DO NOTHING;
                """,
                (
                    payload.ad_creative_id,
                    payload.request_id,
                    payload.bucket,
                    payload.video_path,
                ),
            )
            self.cur.execute(
                """
                SELECT request_id, source_bucket, source_path
                FROM ad_creatives
                WHERE ad_creative_id = %s;
                """,
                (payload.ad_creative_id,),
            )
            creative = self.cur.fetchone()
            expected_source = (
                payload.request_id,
                payload.bucket,
                payload.video_path,
            )
            if creative != expected_source:
                raise PermanentError(
                    "Ad Creative identity does not match its existing source"
                )

            # A redelivered queue message carries the same OCR Run identifier.
            # Completed runs remain immutable; other states resume processing.
            self.cur.execute(
                """
                INSERT INTO ocr_runs (
                    ocr_run_id, ad_creative_id, request_id, status
                )
                VALUES (%s, %s, %s, 'processing')
                ON CONFLICT (ocr_run_id)
                DO UPDATE SET
                    status = CASE
                        WHEN ocr_runs.status = 'completed' THEN 'completed'
                        ELSE 'processing'
                    END,
                    error = CASE
                        WHEN ocr_runs.status = 'completed' THEN ocr_runs.error
                        ELSE NULL
                    END,
                    updated_at = now()
                WHERE ocr_runs.ad_creative_id = EXCLUDED.ad_creative_id
                  AND ocr_runs.request_id = EXCLUDED.request_id
                RETURNING status;
                """,
                (
                    payload.ocr_run_id,
                    payload.ad_creative_id,
                    payload.request_id,
                ),
            )
            run = self.cur.fetchone()
            if run is None:
                raise PermanentError(
                    "OCR Run identity does not match its existing Ad Creative"
                )

        return run[0]

    def fail_ocr_run(self, ocr_run_id, error: str) -> bool:
        """Mark a non-completed OCR Run failed without mutating immutable work."""

        with self.transaction():
            self.cur.execute(
                """
                UPDATE ocr_runs
                SET status = 'failed',
                    error = %s,
                    updated_at = now()
                WHERE ocr_run_id = %s
                  AND request_id = %s
                  AND status <> 'completed'
                RETURNING status;
                """,
                (error[:2000], ocr_run_id, self.request_id),
            )
            updated = self.cur.fetchone()

        return updated is not None
    
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
            (processing_id, *(getattr(row, c) for c in columns))
            for row in rows
        ]
        self.cur.executemany(
            f'INSERT INTO {table} ({", ".join(all_columns)}) VALUES {placeholders};',
            values,
        )
