"""Simple structured logging for Python services.

This module emits structured single-line logs. On Windows consoles the
text encoding for stdout/stderr may not support certain Unicode characters
(e.g. arrows). To avoid raising UnicodeEncodeError we attempt a normal
text write, and on failure fall back to writing UTF-8 bytes directly to the
underlying buffer.
"""
import sys
from typing import TextIO


def log(tag: str, message: str, *, err: bool = False) -> None:
    """Emit a single structured log line.

    Args:
        tag: short tag (e.g. 'server' or 'slides')
        message: the log message
        err: if True, write to stderr (useful for real error output)
    """
    out: TextIO = sys.stderr if err else sys.stdout
    message = message.replace("→", "->").replace("↑", "^").replace("↓", "v")
    line = f"[{tag}] {message}\n"

    try:
        # Preferred: write as text (this may raise UnicodeEncodeError on
        # terminals that can't represent certain characters).
        out.write(line)
        out.flush()
        return
    except UnicodeEncodeError:
        # Fallback: if the TextIO has a buffer attribute, write UTF-8 bytes
        # directly to avoid Python attempting to re-encode using the
        # (possibly restrictive) stream encoding.
        buf = getattr(out, "buffer", None)
        if buf is not None:
            try:
                buf.write(line.encode("utf-8", errors="replace"))
                buf.flush()
                return
            except Exception:
                pass

    # Last resort: try writing to the original low-level stderr buffer.
    try:
        sys.__stderr__.buffer.write(line.encode("utf-8", errors="replace")) # type: ignore
        sys.__stderr__.buffer.flush() # type: ignore
    except Exception:
        # If everything fails, silently ignore to avoid crashing the app.
        try:
            # Best-effort ASCII fallback
            safe = line.encode("ascii", errors="replace").decode("ascii")
            sys.stdout.write(safe)
            sys.stdout.flush()
        except Exception:
            pass


def get_logger(tag: str):
    # Return a callable that mirrors the signature of `log` so callers can
    # optionally pass `err=True` (e.g., `log('msg', err=True)`).
    return lambda message, *, err=False: log(tag, message, err=err)