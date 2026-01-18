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
MATCH_THRESHOLD = 0.50
MATCH_COOLDOWN_WORDS = 8
MATCH_DIFF = 0.12
WINDOW_WORDS = 15

# Neighbor bias
FORWARD_BIAS_MARGIN = 0.05
BACK_BIAS_MARGIN = 0.03