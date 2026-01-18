"""
Central configuration for server runtime and matching behavior.
"""

# Audio / transcription
SAMPLE_RATE = 16000          # Input sample rate; must match WebAudio capture
AUDIO_BUFFER_SECONDS = 8     # Longer buffer = more context, but higher latency

# Whisper settings
WHISPER_MODEL = "distil-large-v3.5"   # Larger = better accuracy, slower startup
WHISPER_DEVICE = "cuda"              # "cuda" for speed, "cpu" for compatibility
WHISPER_COMPUTE_TYPE = "float16"     # Lower precision = faster, can reduce accuracy

# Embeddings
EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"  # Larger model = better semantics, slower

# Matching behavior
MATCH_THRESHOLD = 0.55       # Higher = fewer jumps, lower = more sensitive
MATCH_COOLDOWN_WORDS = 4     # Min words between transitions; higher = steadier
MATCH_DIFF = 0.09            # Required similarity gap vs current slide
WINDOW_WORDS = 14            # More words = better context, can add lag
STAY_BIAS_MARGIN = 0.02      # Extra diff needed to leave current slide

# Recency weighting (bias toward the most recent words)
RECENT_WORDS_COUNT = 10      # How many recent words to emphasize
RECENT_WORDS_MULTIPLIER = 3  # Repeat recent words (>=2 boosts recency)

# Lexical overlap boost (keyword match vs slide text)
KEYWORD_BOOST = 0.10         # Added to similarity for keyword overlap
KEYWORD_MIN_TOKENS = 3       # Minimum speech tokens before boosting

# Sentence-level embeddings (hybrid: only used for current/adjacent slides)
SENTENCE_EMBEDDINGS_ENABLED = True  # More accurate for bullets, slight extra CPU
SENTENCE_MAX_PER_SLIDE = 12         # Cap sentences per slide to control cost
SENTENCE_MIN_CHARS = 20             # Filter very short fragments
SENTENCE_MIN_WORDS = 4              # Filter very short phrases

# Neighbor bias (adjacent slides only)
FORWARD_BIAS_MARGIN = 0.08   # Higher = more eager to advance
BACK_BIAS_MARGIN = 0.03      # Higher = more willing to go back

# Non-adjacent semantic jumps (disable by default)
ALLOW_NON_ADJACENT = False   # True allows skipping to far slides via semantics
NON_ADJACENT_THRESHOLD = 0.75  # Absolute similarity needed for jumps
NON_ADJACENT_BOOST = 0.15      # Extra margin over local best to allow jump

# Trigger (voice command) debounce
TRIGGER_COOLDOWN_MS = 1500   # Minimum time between accepted commands
TRIGGER_TAIL_WORDS = 6       # Only check the last N words for commands
TRIGGER_MIN_WORDS_BETWEEN = 2  # Require some speech between next/back

# Partial speech finalization (stop-talking flush)
PARTIAL_FINALIZE_MS = 800    # Silence threshold to finalize partial text

# Partial matching (fast path while speaking)
PARTIAL_MATCH_ENABLED = True
PARTIAL_MATCH_MIN_WORDS = 6
PARTIAL_MATCH_STABLE_MS = 350
PARTIAL_MATCH_COOLDOWN_MS = 700
PARTIAL_MATCH_IGNORE_COOLDOWN = True