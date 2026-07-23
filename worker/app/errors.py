"""Backward-compatible exports for shared worker failures."""

from config.errors import PermanentError, TransientError

__all__ = ["PermanentError", "TransientError"]
