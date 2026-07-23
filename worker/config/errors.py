"""Shared worker failures used across orchestration and analysis layers."""


class TransientError(Exception):
    """A retryable infrastructure or provider failure."""


class PermanentError(Exception):
    """A non-retryable request, media, or provider failure."""
