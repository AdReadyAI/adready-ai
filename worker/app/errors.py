class TransientError(Exception):
    """Temporary failure that is worth retrying (429, 5xx, timeout, network)."""


class PermanentError(Exception):
    """Failure that will never succeed on retry (400, 401, invalid input)."""