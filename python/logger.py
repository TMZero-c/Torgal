"""Simple structured logging for Python services.

By default this emits to stdout so host processes (like the Electron
launcher) see logs as normal output. Callers can opt into stderr by
passing `err=True` when needed.
"""
import sys


def log(tag: str, message: str, *, err: bool = False) -> None:
    """Emit a single structured log line.

    Args:
        tag: short tag (e.g. 'server' or 'slides')
        message: the log message
        err: if True, write to stderr (useful for real error output)
    """
    out = sys.stderr if err else sys.stdout
    print(f"[{tag}] {message}", file=out, flush=True)


def get_logger(tag: str):
    # Return a callable that mirrors the signature of `log` so callers can
    # optionally pass `err=True` (e.g., `log('msg', err=True)`).
    return lambda message, *, err=False: log(tag, message, err=err)