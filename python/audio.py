"""
Streaming transcription logic (LocalAgreement).
"""
import numpy as np

from config import SAMPLE_RATE, AUDIO_BUFFER_SECONDS
from logger import get_logger

log = get_logger("audio")


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
            self.buffer = self.buffer[-max_samples:]

    def process(self):
        """Returns (confirmed_words, partial_words)."""
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

        # LocalAgreement: confirm words that match previous transcription
        confirmed = []
        if self.last_words and words:
            for last, curr in zip(self.last_words, words):
                if last["word"].lower() == curr["word"].lower():
                    confirmed.append(curr["word"])
                else:
                    break

            # Trim confirmed audio from buffer
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