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
_PREFIX = r'^\s*(?:please\b\s*)?(?:can you\b\s*|could you\b\s*|would you\b\s*|let\'?s\b\s*|we should\b\s*|i want to\b\s*)?'
_SEP = r'(?:\s|[.,;:])+'
_SEP_OPT = r'(?:\s|[.,;:])*'

_PATTERNS = [
    (re.compile(_PREFIX + r'(?:go|move|advance|switch)' + _SEP + r'(?:to' + _SEP_OPT + r')?(?:the' + _SEP_OPT + r')?next' + _SEP_OPT + r'(?:slide|one)\b', re.I), TriggerAction.NEXT),
    (re.compile(_PREFIX + r'(?:go|move|switch)' + _SEP + r'back' + _SEP_OPT + r'(?:a' + _SEP_OPT + r')?(?:slide|one)\b', re.I), TriggerAction.PREV),
    (re.compile(_PREFIX + r'(?:previous|prior)' + _SEP + r'slide\b', re.I), TriggerAction.PREV),
    (re.compile(_PREFIX + r'last' + _SEP + r'slide\b', re.I), TriggerAction.LAST),
    (re.compile(_PREFIX + r'first' + _SEP + r'slide\b', re.I), TriggerAction.FIRST),
    # Number-based patterns - explicit jump
    (re.compile(_PREFIX + r'(?:go|jump|skip)' + _SEP + r'(?:to' + _SEP_OPT + r')?(?:slide' + _SEP_OPT + r')?(\d+)\b', re.I), TriggerAction.GOTO),
    (re.compile(_PREFIX + r'slide' + _SEP + r'(\d+)\b', re.I), TriggerAction.GOTO),  # "slide 5"
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
