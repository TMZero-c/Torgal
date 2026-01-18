"""
Simple structured logging for Python services.
"""
import sys


def log(tag: str, message: str) -> None:
    print(f"[{tag}] {message}", file=sys.stderr, flush=True)


def get_logger(tag: str):
    return lambda message: log(tag, message)