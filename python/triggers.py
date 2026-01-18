"""
Fast explicit trigger phrase detection (runs before embeddings).
Regex-based, ~0.01ms per check.
"""
import re
from typing import Optional, Dict, Any

# Pre-compiled patterns for speed
_PATTERNS = [
    (re.compile(r'\b(next|advance)\s*(slide)?\b', re.I), 'next'),
    (re.compile(r'\b(go\s*)?back\b', re.I), 'prev'),
    (re.compile(r'\b(previous)\s*(slide)?\b', re.I), 'prev'),
    (re.compile(r'\blast\s*slide\b', re.I), 'last'),
    (re.compile(r'\bfirst\s*slide\b', re.I), 'first'),
    # Number-based patterns - more flexible matching
    (re.compile(r'\b(?:go\s*to|goto|jump\s*to|jump|skip\s*to|skip)\s*(?:slide\s*)?(\d+)\b', re.I), 'goto'),
    (re.compile(r'\bslide\s*(\d+)\b', re.I), 'goto'),  # "slide 5" alone
]


def detect_trigger(text: str) -> Optional[Dict[str, Any]]:
    """
    Check for explicit voice commands. Returns immediately on first match.
    
    Returns:
        {"action": "next|prev|goto|first|last", "target": int|None}
        or None if no trigger found
    """
    text = text.lower().strip()
    if len(text) < 3:
        return None
    
    for pattern, action in _PATTERNS:
        match = pattern.search(text)
        if match:
            target = None
            if action == 'goto':
                # For goto patterns, the number is in the first/only capture group
                groups = match.groups()
                for g in groups:
                    if g and g.isdigit():
                        target = int(g) - 1  # 0-indexed
                        break
                # Only return goto if we found a valid number
                if target is None:
                    continue
            return {"action": action, "target": target}
    
    return None
