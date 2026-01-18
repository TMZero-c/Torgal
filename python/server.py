"""
IPC server for streaming transcription + slide matching.
"""
import sys
import json
import base64

from faster_whisper import WhisperModel

from config import (
    WHISPER_MODEL,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
    WINDOW_WORDS,
)
from logger import get_logger
from runtime import setup_cuda_dlls
from audio import Transcriber
from slides import Slide, SlideMatcher

log = get_logger("server")


def send(msg):
    print(json.dumps(msg), flush=True)


def build_whisper_model():
    """Create Whisper model with CUDA fallback to CPU if needed."""
    try:
        log(f"Loading Whisper model ({WHISPER_MODEL} on {WHISPER_DEVICE})...")
        return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
    except Exception as e:
        log(f"Whisper init failed on {WHISPER_DEVICE}: {e}")
        log("Falling back to CPU (int8)")
        return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


def handle_audio(msg, transcriber, matcher, text_window):
    transcriber.add_audio(base64.b64decode(msg["data"]))
    confirmed, partial = transcriber.process()

    confirmed = [w for w in confirmed if w and w.strip()]
    partial = [w for w in partial if w and w.strip()]

    if confirmed:
        log(f"CONFIRMED: {' '.join(confirmed)}")
        send({"type": "final", "text": " ".join(confirmed)})

        if matcher:
            text_window.extend(confirmed)
            text_window[:] = text_window[-WINDOW_WORDS:]
            matcher.add_words(len(confirmed))

            window_text = " ".join(text_window).strip()
            if window_text:
                log(f"Text window: {len(text_window)} words")
                transition = matcher.check(window_text)
                if transition:
                    log(f"SENDING TRANSITION: {transition['from_slide']} → {transition['to_slide']}")
                    send(transition)
                    text_window.clear()

    if partial:
        send({"type": "partial", "text": " ".join(partial)})


def handle_load_slides(msg, text_window):
    log("=" * 50)
    log("LOADING SLIDES")
    log("=" * 50)
    slides_data = msg.get("slides", [])
    log(f"Received {len(slides_data)} slides from main.js")
    for i, s in enumerate(slides_data):
        title = s.get("title", "")
        content = s.get("content", "")
        log(
            f"  Slide {i}: title={type(title).__name__}:'{str(title)[:30]}' "
            f"content={type(content).__name__}:{len(str(content))} chars"
        )

    slides = [
        Slide(i, s.get("title", f"Slide {i + 1}"), s.get("content", ""))
        for i, s in enumerate(slides_data)
    ]
    matcher = SlideMatcher(slides=slides)
    text_window.clear()
    log(f"SlideMatcher created with {len(slides)} slides")
    log("Sending slides_ready to Electron")
    send({"type": "slides_ready", "count": len(slides)})
    return matcher


def main():
    setup_cuda_dlls()
    log("=" * 50)
    log("SERVER STARTING")
    log("=" * 50)

    model = build_whisper_model()
    log("Whisper model loaded!")

    matcher = None
    transcriber = Transcriber(model)
    text_window = []

    log("Sending 'ready' to Electron")
    send({"type": "ready"})
    log("Waiting for messages on stdin...")

    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())

            if msg["type"] == "audio":
                handle_audio(msg, transcriber, matcher, text_window)

            elif msg["type"] == "load_slides":
                matcher = handle_load_slides(msg, text_window)

            elif msg["type"] == "goto_slide":
                if matcher:
                    matcher.goto(msg.get("index", 0))
                    text_window.clear()
                    send({"type": "slide_set", "current_slide": matcher.current})

            elif msg["type"] == "reset":
                transcriber.reset()
                if matcher:
                    matcher.reset()
                text_window.clear()
                send({"type": "reset_done", "current_slide": 0})

        except Exception as e:
            import traceback

            log(f"Error: {e}")
            log(traceback.format_exc())


if __name__ == "__main__":
    main()