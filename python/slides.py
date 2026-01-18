"""
Slide data structures and semantic matching.
Prefers current/adjacent slides by default, with optional non-adjacent overrides
or Q&A mode for global matching.
"""
from dataclasses import dataclass, field
from typing import Optional, List, Set
from functools import lru_cache
import re

import numpy as np

from config import (
    MATCH_THRESHOLD,
    MATCH_COOLDOWN_WORDS,
    MATCH_DIFF,
    FORWARD_BIAS_MARGIN,
    BACK_BIAS_MARGIN,
    STAY_BIAS_MARGIN,
    QA_MODE,
    QA_MATCH_THRESHOLD,
    QA_MATCH_DIFF,
    ALLOW_NON_ADJACENT,
    NON_ADJACENT_THRESHOLD,
    NON_ADJACENT_BOOST,
    KEYWORD_BOOST,
    KEYWORD_MIN_TOKENS,
    TITLE_BOOST,
    TITLE_MIN_TOKENS,
    SENTENCE_EMBEDDINGS_ENABLED,
    SENTENCE_MAX_PER_SLIDE,
    SENTENCE_MIN_CHARS,
    SENTENCE_MIN_WORDS,
)
from embeddings import get_embedding_model
from logger import get_logger

log = get_logger("slides")


_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with",
    "as", "by", "is", "it", "this", "that", "these", "those", "are", "was", "were",
    "be", "been", "being", "at", "from", "we", "you", "they", "i", "he", "she",
    "our", "your", "their", "my", "me", "us", "so", "if", "then", "than", "too",
}


def _tokenize(text: str) -> Set[str]:
    tokens = re.findall(r"[a-z0-9']+", (text or "").lower())
    return {t for t in tokens if len(t) > 2 and t not in _STOPWORDS}


def _split_sentences(text: str) -> List[str]:
    if not text:
        return []

    # Split into raw lines first
    raw_lines = [ln.strip() for ln in re.split(r"[\n\r]+", text) if ln.strip()]

    # Bullet pattern: lines starting with •, -, *, or number followed by . or )
    bullet_pattern = re.compile(r"^(?:[•\-\*]|\d+[.\)])\s*")

    # Join continuation lines (non-bullet lines) to the previous bullet
    merged_lines: List[str] = []
    for line in raw_lines:
        if bullet_pattern.match(line):
            # New bullet - strip the marker and start a new logical line
            cleaned = bullet_pattern.sub("", line).strip()
            if cleaned:
                merged_lines.append(cleaned)
        elif merged_lines:
            # Continuation of previous bullet - append to it
            merged_lines[-1] = merged_lines[-1] + " " + line
        else:
            # First line isn't a bullet, keep as-is
            merged_lines.append(line)

    sentences: List[str] = []
    for line in merged_lines:
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", line) if p.strip()]
        for part in parts:
            if len(part) < SENTENCE_MIN_CHARS:
                continue
            if len(part.split()) < SENTENCE_MIN_WORDS:
                continue
            sentences.append(part)

    # Dedupe and cap
    seen = set()
    unique = []
    for s in sentences:
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)
        if len(unique) >= SENTENCE_MAX_PER_SLIDE:
            break

    return unique


# LRU cache for speech embeddings - avoids re-encoding similar windows
@lru_cache(maxsize=64)
def _cached_encode(text: str) -> tuple:
    """Cache recent speech embeddings. Returns tuple for hashability."""
    model = get_embedding_model()
    emb = model.encode([text], convert_to_numpy=True)[0]
    return tuple(emb.tolist())


def _encode_speech(text: str) -> np.ndarray:
    """Get embedding with caching."""
    return np.array(_cached_encode(text), dtype=np.float32)


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
    tokens: Set[str] = field(default_factory=set, repr=False)
    title_tokens: Set[str] = field(default_factory=set, repr=False)
    sentence_embeddings: Optional[np.ndarray] = field(default=None, repr=False)

    def __post_init__(self):
        if self.embedding is None:
            text = _normalize_text(self.title, self.content, self.index)
            log(f"Embedding slide {self.index}: '{text[:60]}...' ({len(text)} chars)")

            model = get_embedding_model()
            embeddings = model.encode([text], convert_to_numpy=True)
            self.embedding = embeddings[0]
            self.tokens = _tokenize(text)
            self.title_tokens = _tokenize(self.title)

            if SENTENCE_EMBEDDINGS_ENABLED:
                sentences = _split_sentences(text)
                if sentences:
                    sent_embs = model.encode(sentences, convert_to_numpy=True)
                    norms = np.linalg.norm(sent_embs, axis=1, keepdims=True) + 1e-8
                    self.sentence_embeddings = sent_embs / norms
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
        stay_bias: float = STAY_BIAS_MARGIN,
        qa_mode: bool = QA_MODE,
        allow_non_adjacent: bool = ALLOW_NON_ADJACENT,
        non_adjacent_threshold: float = NON_ADJACENT_THRESHOLD,
        non_adjacent_boost: float = NON_ADJACENT_BOOST,
    ):
        """
        Args:
            slides: List of Slide objects (REQUIRED)
            threshold: Min similarity to trigger transition
            cooldown: Min words between transitions
            diff: Required gap between current and target slide
            forward_bias: Margin to prefer next slide vs global best
            back_bias: Margin to prefer previous slide vs global best
            stay_bias: Extra margin required to leave current slide
            qa_mode: Enable global matching (less adjacency bias)
            allow_non_adjacent: Allow jumps to non-adjacent slides
            non_adjacent_threshold: Absolute similarity required for jumps
            non_adjacent_boost: Extra margin over local best for jumps
        """
        log(f"Creating SlideMatcher with {len(slides)} slides")
        if not slides:
            raise ValueError("slides list is required")

        self.slides = slides
        effective_threshold = threshold
        if qa_mode and QA_MATCH_THRESHOLD is not None:
            effective_threshold = QA_MATCH_THRESHOLD
        self.threshold = effective_threshold
        self.cooldown = cooldown
        effective_diff = diff
        if qa_mode and QA_MATCH_DIFF is not None:
            effective_diff = QA_MATCH_DIFF
        self.diff = effective_diff
        self.forward_bias = forward_bias
        self.back_bias = back_bias
        self.stay_bias = stay_bias
        self.qa_mode = qa_mode
        self.allow_non_adjacent = allow_non_adjacent
        self.non_adjacent_threshold = non_adjacent_threshold
        self.non_adjacent_boost = non_adjacent_boost
        log(f"  threshold={self.threshold}, cooldown={cooldown} words, diff={self.diff}")
        log(f"  qa_mode={qa_mode}, allow_non_adjacent={allow_non_adjacent}")
        self.current = 0
        self.words_since = 0
        self.model = get_embedding_model()
        self._embeddings = np.stack([s.embedding for s in self.slides])
        log(f"Matcher ready! Embeddings shape: {self._embeddings.shape}")

    def check(self, text: str, ignore_cooldown: bool = False) -> Optional[dict]:
        """Check if text matches a different slide better than current."""
        text = (text or "").strip()
        if not text:
            log("check() called with empty text, skipping")
            return None
        cooldown_blocked = False
        if not ignore_cooldown and self.words_since < self.cooldown:
            cooldown_blocked = True
            log(f"Cooldown: {self.words_since}/{self.cooldown} words")

        log(f"Checking: '{text}...'")

        try:
            emb = _encode_speech(text)  # Uses LRU cache
        except Exception as e:
            log(f"Encoding error: {e}, text was: '{text[:100]}'", err=True)
            return None

        emb_norm = np.linalg.norm(emb) + 1e-8

        sims = np.dot(self._embeddings, emb) / (
            np.linalg.norm(self._embeddings, axis=1) * np.linalg.norm(emb) + 1e-8
        )

        next_slide = self.current + 1 if self.current + 1 < len(self.slides) else self.current
        prev_slide = self.current - 1 if self.current > 0 else self.current

        # Optionally boost slides that share keywords or title terms with the spoken text.
        sims_used = sims
        speech_tokens = _tokenize(text)
        needs_boost = (
            (KEYWORD_BOOST > 0 and len(speech_tokens) >= KEYWORD_MIN_TOKENS)
            or (TITLE_BOOST > 0 and len(speech_tokens) >= TITLE_MIN_TOKENS)
        )
        boost_indices = None
        if needs_boost:
            sims_used = sims.copy()
            if self.qa_mode:
                boost_indices = range(len(self.slides))
            else:
                boost_indices = {self.current}
                if next_slide != self.current:
                    boost_indices.add(next_slide)
                if prev_slide != self.current:
                    boost_indices.add(prev_slide)
                if self.allow_non_adjacent:
                    boost_indices.add(int(np.argmax(sims)))

        if KEYWORD_BOOST > 0 and len(speech_tokens) >= KEYWORD_MIN_TOKENS and boost_indices:
            for idx in boost_indices:
                overlap = len(speech_tokens & self.slides[idx].tokens) / max(len(speech_tokens), 1)
                if overlap > 0:
                    sims_used[idx] = min(1.0, sims_used[idx] + KEYWORD_BOOST * overlap)

        if TITLE_BOOST > 0 and len(speech_tokens) >= TITLE_MIN_TOKENS and boost_indices:
            for idx in boost_indices:
                overlap = len(speech_tokens & self.slides[idx].title_tokens) / max(len(speech_tokens), 1)
                if overlap > 0:
                    sims_used[idx] = min(1.0, sims_used[idx] + TITLE_BOOST * overlap)

        # Hybrid sentence-level matching for current/adjacent slides
        if SENTENCE_EMBEDDINGS_ENABLED:
            sims_used = sims_used.copy() if sims_used is sims else sims_used
            if self.qa_mode:
                candidate_indices = range(len(self.slides))
            else:
                candidate_indices = {self.current, next_slide, prev_slide}
            for idx in candidate_indices:
                slide = self.slides[idx]
                if slide.sentence_embeddings is None or len(slide.sentence_embeddings) == 0:
                    continue
                sent_sims = np.dot(slide.sentence_embeddings, emb) / emb_norm
                max_sent = float(np.max(sent_sims)) if sent_sims.size else None
                if max_sent is not None and max_sent > sims_used[idx]:
                    sims_used[idx] = max_sent

        best = int(np.argmax(sims_used)) # type: ignore
        sorted_indices = np.argsort(sims_used)[::-1]

        # Consider only current/adjacent slides by default
        if self.qa_mode:
            candidates = list(range(len(self.slides)))
            local_best = best
        else:
            candidates = [self.current]
            if next_slide != self.current:
                candidates.append(next_slide)
            if prev_slide != self.current:
                candidates.append(prev_slide)
            local_best = max(candidates, key=lambda i: sims_used[i])

        log(f"  Prev slide {prev_slide}: sim={sims_used[prev_slide]:.3f}")
        log(f"  Current slide {self.current}: sim={sims_used[self.current]:.3f}")
        log(f"  Next slide {next_slide}: sim={sims_used[next_slide]:.3f}")
        log(f"  Local best slide {local_best}: sim={sims_used[local_best]:.3f}")
        log(f"  Global best slide {best}: sim={sims_used[best]:.3f}")

        if self.qa_mode:
            target = best
            log("  Q&A mode: using global best for transitions")
        else:
            target = local_best

            if next_slide != self.current:
                if sims_used[next_slide] >= sims_used[local_best] - self.forward_bias:
                    target = next_slide
                    log(f"  Forward bias: preferring next slide {next_slide}")

            if prev_slide != self.current and target == local_best:
                if sims_used[prev_slide] >= sims_used[local_best] - self.back_bias:
                    target = prev_slide
                    log(f"  Back bias: preferring prev slide {prev_slide}")

            if self.allow_non_adjacent and best not in candidates:
                required = max(sims_used[local_best] + self.non_adjacent_boost, self.non_adjacent_threshold)
                if sims_used[best] >= required:
                    target = best
                    log(f"  Non-adjacent override: slide {best}")
            elif best not in candidates:
                log("  Non-adjacent disabled: ignoring global best")

        diff = sims_used[target] - sims_used[self.current]
        # stay_bias prevents churn when similarities are close
        required_diff = self.diff if self.qa_mode else max(self.diff, self.stay_bias)

        intent = "stay"
        if target > self.current:
            intent = "forward"
        elif target < self.current:
            intent = "backward"

        non_adjacent = target not in {prev_slide, self.current, next_slide}
        if non_adjacent:
            intent = "jump"

        would_transition = (
            target != self.current
            and sims_used[target] >= self.threshold
            and diff >= required_diff
            and not cooldown_blocked
        )

        # If not transitioning, the actual decision is to stay
        if not would_transition:
            intent = "stay"

        def _format_option_label(idx: int) -> str:
            slide_num = idx + 1
            title = "" if self.slides[idx].title is None else str(self.slides[idx].title).strip()
            if title:
                short = title if len(title) <= 28 else title[:25].rstrip() + "..."
                return f"Slide {slide_num}: {short}"
            return f"Slide {slide_num}"

        options = []
        if self.qa_mode:
            best_idx = best
            runner_idx = best_idx
            for idx in sorted_indices:
                if int(idx) != best_idx:
                    runner_idx = int(idx)
                    break
            options = [
                {
                    "label": _format_option_label(int(best_idx)),
                    "slide": int(best_idx),
                    "sim": float(sims_used[best_idx]),
                },
                {
                    "label": _format_option_label(int(runner_idx)),
                    "slide": int(runner_idx),
                    "sim": float(sims_used[runner_idx]),
                },
                {
                    "label": _format_option_label(int(self.current)),
                    "slide": int(self.current),
                    "sim": float(sims_used[self.current]),
                },
            ]
        else:
            options = [
                {
                    "label": "Prev",
                    "slide": int(prev_slide),
                    "sim": float(sims_used[prev_slide]),
                },
                {
                    "label": "Current",
                    "slide": int(self.current),
                    "sim": float(sims_used[self.current]),
                },
                {
                    "label": "Next",
                    "slide": int(next_slide),
                    "sim": float(sims_used[next_slide]),
                },
            ]

        def _keywords_for_decision() -> list[str]:
            if not speech_tokens:
                return []
            current_tokens = self.slides[self.current].tokens
            target_tokens = self.slides[target].tokens
            if target == self.current:
                base = speech_tokens & current_tokens
                title_tokens = self.slides[self.current].title_tokens
            else:
                overlap_target = speech_tokens & target_tokens
                overlap_current = speech_tokens & current_tokens
                base = overlap_target - overlap_current
                if not base:
                    base = overlap_target
                title_tokens = self.slides[target].title_tokens
            if not base:
                return []
            ordered = sorted(
                base,
                key=lambda w: (0 if w in title_tokens else 1, -len(w), w),
            )
            return ordered[:8]

        def _phrases_for_decision() -> list[str]:
            words = re.findall(r"[a-z0-9']+", text.lower())
            if not words:
                return []
            words = words[:60]
            current_tokens = self.slides[self.current].tokens
            target_tokens = self.slides[target].tokens
            title_tokens = self.slides[target].title_tokens if target != self.current else self.slides[self.current].title_tokens

            candidates = []
            max_len = 3
            for i in range(len(words)):
                for size in range(2, max_len + 1):
                    end = i + size
                    if end > len(words):
                        break
                    chunk = words[i:end]
                    content = [w for w in chunk if len(w) > 2 and w not in _STOPWORDS]
                    if len(content) < 1:
                        continue
                    phrase = " ".join(chunk)
                    candidates.append((phrase, content, i))

            if not candidates:
                return []

            scored = []
            for phrase, content, idx in candidates:
                target_overlap = sum(1 for w in content if w in target_tokens)
                current_overlap = sum(1 for w in content if w in current_tokens)
                title_overlap = sum(1 for w in content if w in title_tokens)
                if target == self.current:
                    if current_overlap < 1:
                        continue
                    score = (current_overlap, title_overlap, len(content))
                else:
                    if target_overlap < 1:
                        continue
                    score = (target_overlap - current_overlap, target_overlap, title_overlap)
                scored.append((score, idx, phrase))

            if not scored:
                return []

            scored.sort(key=lambda item: (-item[0][0], -item[0][1], -item[0][2], item[1]))
            seen = set()
            phrases = []
            for _, _, phrase in scored:
                if phrase in seen:
                    continue
                seen.add(phrase)
                phrases.append(phrase)
                if len(phrases) >= 1:
                    break
            return phrases

        keywords = _keywords_for_decision()
        phrases = _phrases_for_decision()

        eval_payload = {
            "current_slide": int(self.current),
            "prev_slide": int(prev_slide),
            "next_slide": int(next_slide),
            "target_slide": int(target),
            "best_slide": int(best),
            "prev_sim": float(sims_used[prev_slide]),
            "current_sim": float(sims_used[self.current]),
            "next_sim": float(sims_used[next_slide]),
            "target_sim": float(sims_used[target]),
            "best_sim": float(sims_used[best]),
            "threshold": float(self.threshold),
            "required_diff": float(required_diff),
            "diff": float(diff),
            "intent": intent,
            "would_transition": bool(would_transition),
            "qa_mode": bool(self.qa_mode),
            "allow_non_adjacent": bool(self.allow_non_adjacent),
            "non_adjacent": bool(non_adjacent),
            "cooldown_blocked": bool(cooldown_blocked),
            "cooldown_words": int(self.cooldown),
            "words_since": int(self.words_since),
            "options": options,
            "keywords": keywords,
            "phrases": phrases,
        }

        if would_transition:
            old = self.current
            self.current = target
            self.words_since = 0
            log(f"  → TRANSITION! {old} → {target} (diff={diff:.3f})")
            transition_payload = {
                "type": "slide_transition",
                "from_slide": old,
                "to_slide": target,
                "confidence": float(sims_used[target]),
                "slide_title": self.slides[target].title,
                "intent": intent,
            }
            return {"eval": eval_payload, "transition": transition_payload}

        log(f"  → No transition (need diff>={required_diff:.3f}, got {diff:.3f})")
        return {"eval": eval_payload}

    def add_words(self, n: int) -> None:
        self.words_since += n

    def goto(self, index: int) -> None:
        if 0 <= index < len(self.slides):
            self.current = index
            self.words_since = 0

    def reset(self) -> None:
        self.current = 0
        self.words_since = 0

    def set_qa_mode(self, qa_mode: bool) -> None:
        """Toggle Q&A mode at runtime and refresh thresholds/diff."""
        self.qa_mode = bool(qa_mode)
        effective_threshold = MATCH_THRESHOLD
        if self.qa_mode and QA_MATCH_THRESHOLD is not None:
            effective_threshold = QA_MATCH_THRESHOLD
        self.threshold = effective_threshold

        effective_diff = MATCH_DIFF
        if self.qa_mode and QA_MATCH_DIFF is not None:
            effective_diff = QA_MATCH_DIFF
        self.diff = effective_diff

        log(f"QA mode updated: qa_mode={self.qa_mode}, threshold={self.threshold}, diff={self.diff}")
