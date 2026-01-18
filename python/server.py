"""
IPC server for streaming transcription + slide matching.
Includes debounced voice commands and silence-based partial finalization.
"""
import sys
import json
import base64
import time
from dataclasses import dataclass
from enum import Enum

from faster_whisper import WhisperModel

from config import (
    WHISPER_MODEL,
    WHISPER_DEVICE,
    WHISPER_COMPUTE_TYPE,
    WINDOW_WORDS,
    TRIGGER_COOLDOWN_MS,
    TRIGGER_TAIL_WORDS,
    TRIGGER_MIN_WORDS_BETWEEN,
    PARTIAL_FINALIZE_MS,
)
from logger import get_logger
from runtime import setup_cuda_dlls
from audio import Transcriber
from slides import Slide, SlideMatcher
from triggers import detect_trigger, TriggerAction

log = get_logger("server")


class IpcType(str, Enum):
    READY = "ready"
    AUDIO = "audio"
    LOAD_SLIDES = "load_slides"
    GOTO_SLIDE = "goto_slide"
    RESET = "reset"
    FINAL = "final"
    PARTIAL = "partial"
    SLIDE_TRANSITION = "slide_transition"
    SLIDES_READY = "slides_ready"
    SLIDE_SET = "slide_set"
    RESET_DONE = "reset_done"


@dataclass
class CommandState:
    last_ts: float = 0.0


@dataclass
class SpeechState:
    last_partial_text: str = ""
    last_partial_ts: float = 0.0
    last_word_ts: float = 0.0


def send(msg):
    print(json.dumps(msg), flush=True)


def send_type(msg_type: IpcType, **payload):
    payload["type"] = msg_type.value
    send(payload)


def build_whisper_model():
    """Create Whisper model with CUDA fallback to CPU if needed."""
    try:
        log(f"Loading Whisper model ({WHISPER_MODEL} on {WHISPER_DEVICE})...")
        return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
    except Exception as e:
        log(f"Whisper init failed on {WHISPER_DEVICE}: {e}")
        log("Falling back to CPU (int8)")
        return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


def _try_trigger(text, matcher, text_window, command_state: CommandState, allowed_actions: set[TriggerAction]) -> bool:
    """Handle explicit command phrases with cooldown/debounce controls."""
    if not matcher or not text:
        return False

    trigger = detect_trigger(text)
    if not trigger:
        return False

    action = trigger.action
    target = trigger.target
    if action not in allowed_actions:
        return False

    now = time.monotonic()
    cooldown_s = TRIGGER_COOLDOWN_MS / 1000.0
    last_ts = command_state.last_ts
    if (now - last_ts) < cooldown_s:
        log(f"Trigger cooldown: {now - last_ts:.2f}s/{cooldown_s:.2f}s")
        return False

    if action in {TriggerAction.NEXT, TriggerAction.PREV} and matcher.words_since < TRIGGER_MIN_WORDS_BETWEEN:
        log("Trigger debounce: not enough words since last transition")
        return False

    old = matcher.current
    if action == TriggerAction.NEXT:
        if matcher.current >= len(matcher.slides) - 1:
            return False
        matcher.goto(matcher.current + 1)
        send_type(IpcType.SLIDE_TRANSITION, from_slide=old, to_slide=matcher.current,
                  confidence=1.0, intent="Voice: Next")
    elif action == TriggerAction.PREV:
        if matcher.current <= 0:
            return False
        matcher.goto(matcher.current - 1)
        send_type(IpcType.SLIDE_TRANSITION, from_slide=old, to_slide=matcher.current,
                  confidence=1.0, intent="Voice: Back")
    elif action == TriggerAction.GOTO:
        if target is None or not (0 <= target < len(matcher.slides)):
            return False
        matcher.goto(target)
        send_type(IpcType.SLIDE_TRANSITION, from_slide=old, to_slide=matcher.current,
                  confidence=1.0, intent=f"Voice: Go to {target + 1}")
    elif action == TriggerAction.FIRST:
        matcher.goto(0)
        send_type(IpcType.SLIDE_TRANSITION, from_slide=old, to_slide=0,
                  confidence=1.0, intent="Voice: First")
    elif action == TriggerAction.LAST:
        matcher.goto(len(matcher.slides) - 1)
        send_type(IpcType.SLIDE_TRANSITION, from_slide=old, to_slide=matcher.current,
                  confidence=1.0, intent="Voice: Last")
    else:
        return False

    text_window.clear()
    command_state.last_ts = now
    return True


def _process_words(words, matcher, text_window, command_state) -> None:
    """Update window, check explicit commands, then run semantic matching."""
    if not matcher or not words:
        return

    text_window.extend(words)
    text_window[:] = text_window[-WINDOW_WORDS:]
    matcher.add_words(len(words))

    window_text = " ".join(text_window).strip()
    if not window_text:
        return

    tail_text = " ".join(text_window[-TRIGGER_TAIL_WORDS:]).strip()
    if tail_text:
        if _try_trigger(
            tail_text,
            matcher,
            text_window,
            command_state,
            {TriggerAction.NEXT, TriggerAction.PREV, TriggerAction.GOTO, TriggerAction.FIRST, TriggerAction.LAST},
        ):
            return

    transition = matcher.check(window_text)
    if transition:
        log(f"SENDING TRANSITION: {transition['from_slide']} → {transition['to_slide']}")
        send_type(IpcType.SLIDE_TRANSITION, **transition)
        text_window.clear()


def handle_audio(msg, transcriber, matcher, text_window, command_state: CommandState, speech_state: SpeechState):
    transcriber.add_audio(base64.b64decode(msg["data"]))
    confirmed, partial = transcriber.process()
    now = time.monotonic()

    confirmed = [w for w in confirmed if w and w.strip()]
    partial = [w for w in partial if w and w.strip()]

    if confirmed:
        log(f"CONFIRMED: {' '.join(confirmed)}")
        send_type(IpcType.FINAL, text=" ".join(confirmed))

        speech_state.last_partial_text = ""
        speech_state.last_partial_ts = 0.0
        speech_state.last_word_ts = now

        _process_words(confirmed, matcher, text_window, command_state)

    partial_text = " ".join(partial).strip() if partial else ""

    if partial:
        send_type(IpcType.PARTIAL, text=" ".join(partial))

        if partial_text:
            if partial_text != speech_state.last_partial_text:
                speech_state.last_partial_text = partial_text
                speech_state.last_partial_ts = now
            speech_state.last_word_ts = now

        # Fast trigger check on partial text for explicit jumps only
        if matcher and len(partial) >= 2:
            tail_partial = " ".join(partial[-TRIGGER_TAIL_WORDS:]).strip()
            if tail_partial:
                _try_trigger(
                    tail_partial,
                    matcher,
                    text_window,
                    command_state,
                    {TriggerAction.GOTO, TriggerAction.FIRST, TriggerAction.LAST},
                )

    # If speech stops, finalize a stable partial and run matching
    if not confirmed:
        last_partial = speech_state.last_partial_text
        last_ts = speech_state.last_partial_ts
        if last_partial and (now - last_ts) >= (PARTIAL_FINALIZE_MS / 1000.0):
            log("Finalizing stable partial after silence")
            send_type(IpcType.FINAL, text=last_partial)
            words = [w for w in last_partial.split() if w]
            _process_words(words, matcher, text_window, command_state)
            speech_state.last_partial_text = ""
            speech_state.last_partial_ts = 0.0


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
    send_type(IpcType.SLIDES_READY, count=len(slides))
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
    command_state = CommandState()
    speech_state = SpeechState()

    log("Sending 'ready' to Electron")
    send_type(IpcType.READY)
    log("Waiting for messages on stdin...")

    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())

            if msg["type"] == IpcType.AUDIO.value:
                handle_audio(msg, transcriber, matcher, text_window, command_state, speech_state)

            elif msg["type"] == IpcType.LOAD_SLIDES.value:
                matcher = handle_load_slides(msg, text_window)

            elif msg["type"] == IpcType.GOTO_SLIDE.value:
                if matcher:
                    matcher.goto(msg.get("index", 0))
                    text_window.clear()
                    send_type(IpcType.SLIDE_SET, current_slide=matcher.current)

            elif msg["type"] == IpcType.RESET.value:
                transcriber.reset()
                if matcher:
                    matcher.reset()
                text_window.clear()
                speech_state.last_partial_text = ""
                speech_state.last_partial_ts = 0.0
                speech_state.last_word_ts = 0.0
                send_type(IpcType.RESET_DONE, current_slide=0)

        except Exception as e:
            import traceback

            log(f"Error: {e}")
            log(traceback.format_exc())


if __name__ == "__main__":
    main()