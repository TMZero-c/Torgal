"""
Central configuration for server runtime and matching behavior.
"""

# Audio / transcription
SAMPLE_RATE = 16000          # Input sample rate; must match WebAudio capture
AUDIO_BUFFER_SECONDS = 15    # Longer buffer = more context, but higher latency

# Whisper settings
WHISPER_MODEL = "distil-medium.en"   # Larger = better accuracy, slower startup
WHISPER_DEVICE = "cuda"              # "cuda" for speed, "cpu" for compatibility
WHISPER_COMPUTE_TYPE = "float16"     # Lower precision = faster, can reduce accuracy

# Embeddings
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"  # Larger model = better semantics, slower

# Matching behavior
MATCH_THRESHOLD = 0.58       # Higher = fewer jumps, lower = more sensitive
MATCH_COOLDOWN_WORDS = 10    # Min words between transitions; higher = steadier
MATCH_DIFF = 0.12            # Required similarity gap vs current slide
WINDOW_WORDS = 20            # More words = better context, can add lag
STAY_BIAS_MARGIN = 0.03      # Extra diff needed to leave current slide

# Neighbor bias (adjacent slides only)
FORWARD_BIAS_MARGIN = 0.04   # Higher = more eager to advance
BACK_BIAS_MARGIN = 0.03      # Higher = more willing to go back

# Non-adjacent semantic jumps (disable by default)
ALLOW_NON_ADJACENT = False   # True allows skipping to far slides via semantics
NON_ADJACENT_THRESHOLD = 0.75  # Absolute similarity needed for jumps
NON_ADJACENT_BOOST = 0.15      # Extra margin over local best to allow jump

# Trigger (voice command) debounce
TRIGGER_COOLDOWN_MS = 1200   # Minimum time between accepted commands
TRIGGER_TAIL_WORDS = 6       # Only check the last N words for commands
TRIGGER_MIN_WORDS_BETWEEN = 4  # Require some speech between next/back

# Partial speech finalization (stop-talking flush)
PARTIAL_FINALIZE_MS = 2000   # Silence threshold to finalize partial text