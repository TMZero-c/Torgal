"""
Streaming transcription (LocalAgreement) with fuzzy stability matching.
Trims confirmed audio to keep latency low while preserving context.
"""
import re
import numpy as np

from config import AUDIO, WHISPER, FILTER
from logger import get_logger

log = get_logger("audio")

# Garbage pattern: no letters at all
_GARBAGE_PATTERN = re.compile(r'^[^a-zA-Z]*$')


def _is_garbage(word: str) -> bool:
    """Check if a word is garbage (punctuation, too short, hallucination pattern)."""
    w = word.strip().lower()
    if not w:
        return True
    # No letters at all (punctuation only)
    if FILTER.filter_punctuation and _GARBAGE_PATTERN.match(w):
        return True
    # Too short (single letters except 'I' and 'a')
    if len(w) < FILTER.min_word_length and w not in ('i', 'a'):
        return True
    # Starts with punctuation/hyphen (ASR artifacts like "-huzned")
    if w[0] in '-.,;:!?':
        return True
    return False


def _filter_words(words: list) -> list:
    """Filter out garbage words and dedupe consecutive repeats."""
    filtered = []
    last_word = None
    for w in words:
        if _is_garbage(w):
            continue
        # Skip consecutive duplicates
        if FILTER.dedupe_consecutive and w.lower() == last_word:
            continue
        filtered.append(w)
        last_word = w.lower()
    return filtered


def _fuzzy_match(w1: str, w2: str) -> bool:
    """Fast fuzzy match for common ASR variations (low CPU, tolerant to minor drift)."""
    w1, w2 = w1.lower().strip(), w2.lower().strip()
    if w1 == w2:
        return True
    # Don't fuzzy match short words - too many false positives
    min_len = FILTER.fuzzy_match_min_len
    if len(w1) < min_len or len(w2) < min_len:
        return False
    # Prefix match (e.g., "going" vs "go", "want" vs "wanna")
    match_len = min(len(w1), len(w2))
    if match_len >= min_len and w1[:match_len] == w2[:match_len]:
        return True
    # One-char difference tolerance for longer words
    if abs(len(w1) - len(w2)) <= 1 and len(w1) >= min_len + 1:
        diffs = sum(c1 != c2 for c1, c2 in zip(w1, w2))
        return diffs <= 1
    return False


class Transcriber:
    """Streaming transcription with LocalAgreement for stability."""

    def __init__(self, model, sample_rate: int = None, buffer_seconds: int = None):
        self.model = model
        self.sample_rate = sample_rate or AUDIO.sample_rate
        self.buffer_seconds = buffer_seconds or AUDIO.buffer_seconds
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []
        self.batch_chunks: list[np.ndarray] = []
        self.batch_samples = 0
        self.hotwords: str | None = None  # Comma-separated keywords to boost
        self._confirmed_count = 0  # Track how many words we've confirmed total

    def set_hotwords(self, keywords: list[str]) -> None:
        """Set hotwords from slide keywords to boost recognition accuracy."""
        if keywords:
            # faster-whisper expects comma-separated string
            self.hotwords = ", ".join(keywords[:50])  # Limit to 50 keywords
            log(f"Hotwords set: {len(keywords)} keywords")
        else:
            self.hotwords = None

    def add_audio(self, pcm_bytes: bytes) -> None:
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, samples])
        max_samples = self.buffer_seconds * self.sample_rate
        if len(self.buffer) > max_samples:
            # Sliding window buffer: more seconds = more context, but higher latency.
            self.buffer = self.buffer[-max_samples:]

    def add_audio_batch(self, pcm_bytes: bytes) -> None:
        """Append audio for batch mode without sliding buffer churn."""
        if not pcm_bytes:
            return
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size == 0:
            return
        self.batch_chunks.append(samples)
        self.batch_samples += samples.size

    def process(self):
        """Returns (confirmed_words, partial_words).

        Confirmed words are stable across consecutive passes; partial words may change.
        """
        if len(self.buffer) < self.sample_rate:
            return [], []

        # Build transcribe kwargs
        transcribe_kwargs = dict(
            beam_size=WHISPER.beam_size,
            language="en",
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        # Add hotwords if set (boosts recognition of slide-specific terms)
        if self.hotwords:
            transcribe_kwargs["hotwords"] = self.hotwords

        segments, _ = self.model.transcribe(self.buffer, **transcribe_kwargs)

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
        
        # Filter garbage from both confirmed and partial
        confirmed = _filter_words(confirmed)
        partial = _filter_words(partial)
        
        return confirmed, partial

    def process_batch(self):
        """Process audio as a single batch - no LocalAgreement, just transcribe and clear.
        
        This is better for batch mode where we don't need streaming stability.
        Returns all words as 'confirmed' since there's no partial in batch mode.
        """
        min_samples = int(self.sample_rate * 0.25)
        if self.batch_samples < min_samples:
            return []

        # Build transcribe kwargs - use higher beam for batch (more accurate)
        transcribe_kwargs = dict(
            beam_size=max(WHISPER.beam_size, WHISPER.batch_beam_size),
            language="en",
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        if self.hotwords:
            transcribe_kwargs["hotwords"] = self.hotwords

        if not self.batch_chunks:
            return []

        audio = self.batch_chunks[0] if len(self.batch_chunks) == 1 else np.concatenate(self.batch_chunks)
        segments, _ = self.model.transcribe(audio, **transcribe_kwargs)

        words = []
        for seg in segments:
            if seg.words:
                words.extend(w.word.strip() for w in seg.words)

        # Filter garbage and dedupe
        words = _filter_words(words)
        
        # Clear batch buffers completely for next batch
        self.batch_chunks = []
        self.batch_samples = 0
        self.last_words = []
        
        return words

    def reset(self) -> None:
        self.buffer = np.array([], dtype=np.float32)
        self.last_words = []
        self._confirmed_count = 0
        self.batch_chunks = []
        self.batch_samples = 0