"""
Slide matching using semantic embeddings.
Compares live transcript against slide content to detect transitions.
"""
import sys
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, List

def log(msg):
    print(f"[slides] {msg}", file=sys.stderr, flush=True)

# Lazy load embedding model
_model = None
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"  # 384-dim, fast and reliable

def get_embedding_model():
    """Lazy load the sentence transformer model"""
    global _model
    if _model is None:
        log(f"Loading embedding model ({EMBEDDING_MODEL})...")
        import torch
        log(f"PyTorch version: {torch.__version__}")
        log(f"CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            log(f"CUDA device: {torch.cuda.get_device_name(0)}")
        from sentence_transformers import SentenceTransformer
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        log(f"Using device: {device}")
        _model = SentenceTransformer(EMBEDDING_MODEL, device=device)
        log("Embedding model loaded!")
    return _model


@dataclass
class Slide:
    index: int
    title: str
    content: str
    embedding: np.ndarray = field(default=None, repr=False) # type: ignore
    
    def __post_init__(self):
        if self.embedding is None:
            # Ensure we have valid strings (handle None, numbers, lists, etc.)
            title = str(self.title) if self.title is not None else ""
            content = str(self.content) if self.content is not None else ""
            title = title.strip()
            content = content.strip()
            text = f"{title}. {content}".strip()
            if not text or text == ".":
                text = f"Slide {self.index}"
            
            # Clean text: remove null bytes, normalize whitespace, keep ASCII + common chars
            text = text.replace('\x00', '').replace('\r', '\n')
            text = ' '.join(text.split())  # normalize whitespace
            # Remove any non-printable characters
            text = ''.join(c if c.isprintable() or c == ' ' else ' ' for c in text)
            text = ' '.join(text.split())  # re-normalize
            
            log(f"Embedding slide {self.index}: '{text[:60]}...' ({len(text)} chars)")
            
            model = get_embedding_model()
            embeddings = model.encode([text], convert_to_numpy=True)
            self.embedding = embeddings[0]
            log(f"  → {self.embedding.shape[0]}-dim vector")


class SlideMatcher:
    def __init__(self, slides: List[Slide], threshold: float = 0.45, cooldown: int = 20):
        """
        Args:
            slides: List of Slide objects (REQUIRED - no mock data)
            threshold: Min similarity to trigger transition
            cooldown: Min words between transitions
        """
        log(f"Creating SlideMatcher with {len(slides)} slides")
        log(f"  threshold={threshold}, cooldown={cooldown} words")
        if not slides:
            raise ValueError("slides list is required")
        
        self.slides = slides
        self.threshold = threshold
        self.cooldown = cooldown
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
            # Get similarity to all slides (encode as batch for robustness)
            embeddings = self.model.encode([text], convert_to_numpy=True)
            emb = embeddings[0]
        except Exception as e:
            log(f"Encoding error: {e}, text was: '{text[:100]}'")
            return None
        sims = np.dot(self._embeddings, emb) / (
            np.linalg.norm(self._embeddings, axis=1) * np.linalg.norm(emb) + 1e-8
        )
        
        best = int(np.argmax(sims))
        log(f"  Current slide {self.current}: sim={sims[self.current]:.3f}")
        log(f"  Best match slide {best}: sim={sims[best]:.3f}")
        
        # Transition if different slide is significantly better
        if best != self.current and sims[best] >= self.threshold and sims[best] - sims[self.current] >= 0.08:
            old = self.current
            self.current = best
            self.words_since = 0
            log(f"  → TRANSITION! {old} → {best}")
            return {
                "type": "slide_transition",
                "from_slide": old,
                "to_slide": best,
                "confidence": float(sims[best]),
                "slide_title": self.slides[best].title
            }
        log(f"  → No transition (threshold={self.threshold}, diff needed=0.08)")
        return None
    
    def add_words(self, n: int):
        self.words_since += n
    
    def goto(self, index: int):
        if 0 <= index < len(self.slides):
            self.current = index
            self.words_since = 0
    
    def reset(self):
        self.current = 0
        self.words_since = 0
