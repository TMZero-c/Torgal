"""
Streaming transcription (LocalAgreement) with fuzzy stability matching.
Trims confirmed audio to keep latency low while preserving context.
"""
import numpy as np

from config import SAMPLE_RATE, AUDIO_BUFFER_SECONDS
from logger import get_logger

log = get_logger("audio")


def _fuzzy_match(w1: str, w2: str) -> bool:
    """Fast fuzzy match for common ASR variations (low CPU, tolerant to minor drift)."""
    w1, w2 = w1.lower().strip(), w2.lower().strip()
    if w1 == w2:
        return True
    # Handle common contractions/variations without expensive difflib
    if len(w1) < 3 or len(w2) < 3:
        return False
    # Prefix match (e.g., "going" vs "go", "want" vs "wanna")
    min_len = min(len(w1), len(w2))
    if min_len >= 3 and w1[:min_len] == w2[:min_len]:
        return True
    # One-char difference tolerance for longer words
    if abs(len(w1) - len(w2)) <= 1 and len(w1) >= 4:
        diffs = sum(c1 != c2 for c1, c2 in zip(w1, w2))
        return diffs <= 1
    return False


class Transcriber:
    """Streaming transcription with LocalAgreement for stability."""

    def __init__(self, model, sample_rate: int = SAMPLE_RATE, buffer_seconds: int = AUDIO_BUFFER_SECONDS):
        self.model = model
        self.sample_rate = sample_rate
        self.buffer_seconds = buffer_seconds
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []

    def add_audio(self, pcm_bytes: bytes) -> None:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, samples])
        max_samples = self.buffer_seconds * self.sample_rate
        if len(self.buffer) > max_samples:
            # Sliding window buffer: more seconds = more context, but higher latency.
            self.buffer = self.buffer[-max_samples:]

    def process(self):
        """Returns (confirmed_words, partial_words).

        Confirmed words are stable across consecutive passes; partial words may change.
        """
        if len(self.buffer) < self.sample_rate:
            return [], []

        segments, _ = self.model.transcribe(
            self.buffer,
            beam_size=1,
            language="en",
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )

        words = []
        for seg in segments:
            if seg.words:
                words.extend({"word": w.word.strip(), "end": w.end} for w in seg.words)

        # LocalAgreement: confirm words that match previous transcription (with fuzzy matching)
        confirmed = []
        if self.last_words and words:
            for last, curr in zip(self.last_words, words):
                if _fuzzy_match(last["word"], curr["word"]):
                    confirmed.append(curr["word"])
                else:
                    break

            # Trim confirmed audio from buffer to reduce latency
            if confirmed and words[len(confirmed) - 1]["end"]:
                trim = int(words[len(confirmed) - 1]["end"] * self.sample_rate)
                if 0 < trim < len(self.buffer):
                    self.buffer = self.buffer[trim:]

        self.last_words = words
        partial = [w["word"] for w in words[len(confirmed):]]
        return confirmed, partial

    def reset(self) -> None:
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []