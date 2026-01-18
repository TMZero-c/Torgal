"""
Slide matching using semantic embeddings.
Compares live transcript against slide content to detect transitions.
"""
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, List

# Lazy load embedding model
_model = None

def get_embedding_model():
    """Lazy load the sentence transformer model"""
    global _model
    if _model is None:
        import torch
        from sentence_transformers import SentenceTransformer
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        _model = SentenceTransformer('all-MiniLM-L6-v2', device=device)
    return _model


@dataclass
class Slide:
    index: int
    title: str
    content: str
    embedding: np.ndarray = field(default=None, repr=False) # type: ignore
    
    def __post_init__(self):
        if self.embedding is None:
            model = get_embedding_model()
            self.embedding = model.encode(f"{self.title}. {self.content}", convert_to_numpy=True)


class SlideMatcher:
    def __init__(self, slides: List[Slide], threshold: float = 0.45, cooldown: int = 20):
        """
        Args:
            slides: List of Slide objects (REQUIRED - no mock data)
            threshold: Min similarity to trigger transition
            cooldown: Min words between transitions
        """
        if not slides:
            raise ValueError("slides list is required")
        
        self.slides = slides
        self.threshold = threshold
        self.cooldown = cooldown
        self.current = 0
        self.words_since = 0
        self.model = get_embedding_model()
        self._embeddings = np.stack([s.embedding for s in self.slides])
    
    def check(self, text: str) -> Optional[dict]:
        """Check if text matches a different slide better than current."""
        if not text.strip() or self.words_since < self.cooldown:
            return None
        
        # Get similarity to all slides
        emb = self.model.encode(text, convert_to_numpy=True)
        sims = np.dot(self._embeddings, emb) / (
            np.linalg.norm(self._embeddings, axis=1) * np.linalg.norm(emb) + 1e-8
        )
        
        best = int(np.argmax(sims))
        
        # Transition if different slide is significantly better
        if best != self.current and sims[best] >= self.threshold and sims[best] - sims[self.current] >= 0.08:
            old = self.current
            self.current = best
            self.words_since = 0
            return {
                "type": "slide_transition",
                "from_slide": old,
                "to_slide": best,
                "confidence": float(sims[best]),
                "slide_title": self.slides[best].title
            }
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
