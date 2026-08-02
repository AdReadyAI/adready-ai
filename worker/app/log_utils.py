"""Shared logging helpers for consistent phase/task timing across the worker."""

import time
from contextlib import contextmanager


@contextmanager
def phase(logger, label: str):
    """Log start/finish/failure of a named phase with elapsed time.

    Usage:
        with phase(logger, "[job 1] Preprocessing"):
            ...

    Logs "<label> started" on entry, "<label> finished in X.Xs" on success,
    or "<label> failed after X.Xs: <error>" on exception (which is re-raised).
    """
    start = time.perf_counter()
    logger.info("%s started", label)
    try:
        yield
    except Exception as e:
        elapsed = time.perf_counter() - start
        logger.error("%s failed after %.2fs: %s", label, elapsed, e)
        raise
    else:
        elapsed = time.perf_counter() - start
        logger.info("%s finished in %.2fs", label, elapsed)
