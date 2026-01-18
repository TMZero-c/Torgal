"""
Slide data structures and semantic matching.
"""
from dataclasses import dataclass, field
from typing import Optional, List

import numpy as np

from config import (
    MATCH_THRESHOLD,
    MATCH_COOLDOWN_WORDS,
    MATCH_DIFF,
    FORWARD_BIAS_MARGIN,
    BACK_BIAS_MARGIN,
)
from embeddings import get_embedding_model
from logger import get_logger

log = get_logger("slides")


def _normalize_text(title: str, content: str, index: int) -> str:
    title = str(title) if title is not None else ""
    content = str(content) if content is not None else ""
    title = title.strip()
    content = content.strip()

    text = f"{title}. {content}".strip()
    if not text or text == ".":
        text = f"Slide {index}"

    text = text.replace("\x00", "").replace("\r", "\n")
    text = " ".join(text.split())
    text = "".join(c if c.isprintable() or c == " " else " " for c in text)
    text = " ".join(text.split())
    return text


@dataclass
class Slide:
    index: int
    title: str
    content: str
    embedding: np.ndarray = field(default=None, repr=False)  # type: ignore

    def __post_init__(self):
        if self.embedding is None:
            text = _normalize_text(self.title, self.content, self.index)
            log(f"Embedding slide {self.index}: '{text[:60]}...' ({len(text)} chars)")

            model = get_embedding_model()
            embeddings = model.encode([text], convert_to_numpy=True)
            self.embedding = embeddings[0]
            log(f"  → {self.embedding.shape[0]}-dim vector")


class SlideMatcher:
    def __init__(
        self,
        slides: List[Slide],
        threshold: float = MATCH_THRESHOLD,
        cooldown: int = MATCH_COOLDOWN_WORDS,
        diff: float = MATCH_DIFF,
        forward_bias: float = FORWARD_BIAS_MARGIN,
        back_bias: float = BACK_BIAS_MARGIN,
    ):
        """
        Args:
            slides: List of Slide objects (REQUIRED)
            threshold: Min similarity to trigger transition
            cooldown: Min words between transitions
            diff: Required gap between current and target slide
            forward_bias: Margin to prefer next slide vs global best
            back_bias: Margin to prefer previous slide vs global best
        """
        log(f"Creating SlideMatcher with {len(slides)} slides")
        log(f"  threshold={threshold}, cooldown={cooldown} words, diff={diff}")
        if not slides:
            raise ValueError("slides list is required")

        self.slides = slides
        self.threshold = threshold
        self.cooldown = cooldown
        self.diff = diff
        self.forward_bias = forward_bias
        self.back_bias = back_bias
        self.current = 0
        self.words_since = 0
        self.model = get_embedding_model()
        self._embeddings = np.stack([s.embedding for s in self.slides])
        log(f"Matcher ready! Embeddings shape: {self._embeddings.shape}")

    def check(self, text: str) -> Optional[dict]:
        """Check if text matches a different slide better than current."""
        text = (text or "").strip()
        if not text:
            log("check() called with empty text, skipping")
            return None
        if self.words_since < self.cooldown:
            log(f"Cooldown: {self.words_since}/{self.cooldown} words")
            return None

        log(f"Checking: '{text[:50]}...'")

        try:
            embeddings = self.model.encode([text], convert_to_numpy=True)
            emb = embeddings[0]
        except Exception as e:
            log(f"Encoding error: {e}, text was: '{text[:100]}'")
            return None

        sims = np.dot(self._embeddings, emb) / (
            np.linalg.norm(self._embeddings, axis=1) * np.linalg.norm(emb) + 1e-8
        )

        best = int(np.argmax(sims))
        next_slide = self.current + 1 if self.current + 1 < len(self.slides) else self.current
        prev_slide = self.current - 1 if self.current > 0 else self.current

        log(f"  Prev slide {prev_slide}: sim={sims[prev_slide]:.3f}")
        log(f"  Current slide {self.current}: sim={sims[self.current]:.3f}")
        log(f"  Next slide {next_slide}: sim={sims[next_slide]:.3f}")
        log(f"  Global best slide {best}: sim={sims[best]:.3f}")

        target = best

        if next_slide != self.current:
            if sims[next_slide] >= sims[best] - self.forward_bias:
                target = next_slide
                log(f"  Forward bias: preferring next slide {next_slide}")

        if prev_slide != self.current and target == best:
            if sims[prev_slide] >= sims[best] - self.back_bias:
                target = prev_slide
                log(f"  Back bias: preferring prev slide {prev_slide}")

        diff = sims[target] - sims[self.current]
        if target != self.current and sims[target] >= self.threshold and diff >= self.diff:
            old = self.current
            self.current = target
            self.words_since = 0
            log(f"  → TRANSITION! {old} → {target} (diff={diff:.3f})")
            return {
                "type": "slide_transition",
                "from_slide": old,
                "to_slide": target,
                "confidence": float(sims[target]),
                "slide_title": self.slides[target].title,
            }

        log(f"  → No transition (need diff>={self.diff}, got {diff:.3f})")
        return None

    def add_words(self, n: int) -> None:
        self.words_since += n

    def goto(self, index: int) -> None:
        if 0 <= index < len(self.slides):
            self.current = index
            self.words_since = 0

    def reset(self) -> None:
        self.current = 0
        self.words_since = 0
