"""
Embedding model loader and device selection.
"""
from config import EMBEDDING_MODEL, EMBEDDING_DEVICE
from logger import get_logger

log = get_logger("embeddings")
_model = None


def get_embedding_model():
    """Lazy load the sentence transformer model."""
    global _model
    if _model is None:
        log(f"Loading embedding model ({EMBEDDING_MODEL})...")
        import torch
        log(f"PyTorch version: {torch.__version__}")
        log(f"CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            log(f"CUDA device: {torch.cuda.get_device_name(0)}")
        from sentence_transformers import SentenceTransformer
        requested = (EMBEDDING_DEVICE or "auto").lower()
        if requested == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        elif requested == "cuda":
            if torch.cuda.is_available():
                device = "cuda"
            else:
                log("CUDA requested for embeddings but not available; falling back to CPU")
                device = "cpu"
        elif requested == "cpu":
            device = "cpu"
        else:
            log(f"Unknown embedding device '{EMBEDDING_DEVICE}', falling back to auto")
            device = "cuda" if torch.cuda.is_available() else "cpu"
        log(f"Using device: {device}")
        _model = SentenceTransformer(EMBEDDING_MODEL, device=device)
        log("Embedding model loaded!")
    return _model