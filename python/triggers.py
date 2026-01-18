"""
Fast explicit trigger phrase detection (runs before embeddings).
Regex-based, ~0.01ms per check.
"""
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class TriggerAction(str, Enum):
    NEXT = "next"
    PREV = "prev"
    GOTO = "goto"
    FIRST = "first"
    LAST = "last"


@dataclass(frozen=True)
class Trigger:
    action: TriggerAction
    target: Optional[int] = None


# Pre-compiled patterns for speed
# Note: patterns are anchored to the start to avoid mid-sentence matches.
_PATTERNS = [
    (re.compile(r'^\s*(?:please\s+)?(?:go|move|advance|switch)\s*(?:to\s*)?(?:the\s*)?next\s*(?:slide|one)\b', re.I), TriggerAction.NEXT),
    (re.compile(r'^\s*(?:please\s+)?(?:go|move|switch)\s*back\s*(?:a\s*)?(?:slide|one)\b', re.I), TriggerAction.PREV),
    (re.compile(r'^\s*(?:please\s+)?(?:previous|prior)\s*slide\b', re.I), TriggerAction.PREV),
    (re.compile(r'^\s*(?:please\s+)?last\s*slide\b', re.I), TriggerAction.LAST),
    (re.compile(r'^\s*(?:please\s+)?first\s*slide\b', re.I), TriggerAction.FIRST),
    # Number-based patterns - explicit jump
    (re.compile(r'^\s*(?:please\s+)?(?:go|jump|skip)\s*(?:to\s*)?(?:slide\s*)?(\d+)\b', re.I), TriggerAction.GOTO),
    (re.compile(r'^\s*(?:please\s+)?slide\s*(\d+)\b', re.I), TriggerAction.GOTO),  # "slide 5"
]


def detect_trigger(text: str) -> Optional[Trigger]:
    """
    Check for explicit voice commands (anchored at start of utterance).
    Returns immediately on first match.
    
    Returns:
        Trigger(action=..., target=...)
        or None if no trigger found
    """
    text = text.lower().strip()
    if len(text) < 3:
        return None
    
    for pattern, action in _PATTERNS:
        match = pattern.search(text)
        if match:
            target = None
            if action == TriggerAction.GOTO:
                # For goto patterns, the number is in the first/only capture group
                groups = match.groups()
                for g in groups:
                    if g and g.isdigit():
                        target = int(g) - 1  # 0-indexed
                        break
                # Only return goto if we found a valid number
                if target is None:
                    continue
            return Trigger(action=action, target=target)
    
    return None
