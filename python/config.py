"""
Central configuration for server runtime and matching behavior.
"""

# Audio / transcription
SAMPLE_RATE = 16000
AUDIO_BUFFER_SECONDS = 15

# Whisper settings
WHISPER_MODEL = "distil-medium.en"
WHISPER_DEVICE = "cuda"
WHISPER_COMPUTE_TYPE = "float16"

# Embeddings
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"

# Matching behavior
MATCH_THRESHOLD = 0.55       # Slightly higher to reduce false positives
MATCH_COOLDOWN_WORDS = 6     # Reduced - we have fuzzy matching now
MATCH_DIFF = 0.10            # Slightly lower diff threshold
WINDOW_WORDS = 20            # Larger window for more context

# Neighbor bias
FORWARD_BIAS_MARGIN = 0.06   # Slightly prefer forward progression
BACK_BIAS_MARGIN = 0.03