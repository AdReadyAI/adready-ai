from contextlib import contextmanager

from analyzer.output_models import TaskResult

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

    def product_url_requiring_context(self) -> str | None:
        """Return the Product Reference URL only when extracted context is missing."""
        self.cur.execute(
            """
            SELECT r.product_url
            FROM requests AS r
            LEFT JOIN product_context AS pc ON pc.request_id = r.request_id
            WHERE r.request_id = %s
              AND NULLIF(BTRIM(r.product_url), '') IS NOT NULL
              AND NULLIF(BTRIM(pc.raw_text), '') IS NULL;
            """,
            (self.request_id,),
        )
        row = self.cur.fetchone()
        return row[0] if row else None

    def upsert_product_context(
        self,
        raw_text: str,
        reference_asset_urls: tuple[str, ...],
    ) -> None:
        """Persist extracted Product Reference values without replacing curated fields."""
        with self.transaction():
            self.cur.execute(
                """
                INSERT INTO product_context (request_id, raw_text, reference_asset_urls)
                VALUES (%s, %s, %s)
                ON CONFLICT (request_id)
                DO UPDATE SET
                  raw_text = EXCLUDED.raw_text,
                  reference_asset_urls = ARRAY(
                    SELECT DISTINCT UNNEST(
                      product_context.reference_asset_urls
                      || EXCLUDED.reference_asset_urls
                    )
                  );
                """,
                (self.request_id, raw_text, list(reference_asset_urls)),
            )
    
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
