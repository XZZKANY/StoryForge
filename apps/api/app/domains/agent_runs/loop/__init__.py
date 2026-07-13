from typing import Any

from app.domains.agent_runs.intent import SUPPORTED_INTENTS, detect_intent, message_args, message_text
from app.domains.agent_runs.loop.types import ChatLoopOutcome, LoopRoundResult, LoopToolCall, LoopToolFeedback

_LOOP_RUNTIME_EXPORTS = frozenset({"ChatLoopUnavailableError", "run_chat_loop"})


def __getattr__(name: str) -> Any:
    if name in _LOOP_RUNTIME_EXPORTS:
        from app.domains.agent_runs import loop_runtime

        return getattr(loop_runtime, name)
    raise AttributeError(name)

__all__ = [
    "SUPPORTED_INTENTS",
    "ChatLoopOutcome",
    "ChatLoopUnavailableError",
    "LoopRoundResult",
    "LoopToolCall",
    "LoopToolFeedback",
    "detect_intent",
    "message_args",
    "message_text",
    "run_chat_loop",
]
