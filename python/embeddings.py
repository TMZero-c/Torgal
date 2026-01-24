"""
Embedding model loader and device selection.
"""
from config import EMBEDDING_MODEL, EMBEDDING_DEVICE
from logger import get_logger

log = get_logger("embeddings")
_model = None


def get_embedding_model():
    """Lazy load the sentence transformer model with GPU auto-detection."""
    global _model
    if _model is None:
        log(f"Loading embedding model ({EMBEDDING_MODEL})...")
        import torch
        log(f"PyTorch version: {torch.__version__}")
        
        # Detect GPU type (NVIDIA CUDA or AMD ROCm)
        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            log(f"GPU available: {device_name}")
            # Check for ROCm backend
            if hasattr(torch.version, 'hip') and torch.version.hip is not None:
                log(f"ROCm version: {torch.version.hip}")
        else:
            log("No GPU available")
        
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