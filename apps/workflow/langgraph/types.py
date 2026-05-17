from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


_RESUME_VALUE: ContextVar[Any] = ContextVar("_RESUME_VALUE", default=None)
_HAS_RESUME: ContextVar[bool] = ContextVar("_HAS_RESUME", default=False)


@dataclass(frozen=True)
class Command:
    resume: Any = None


@dataclass(frozen=True)
class Interrupt:
    value: Any


class InterruptSignal(RuntimeError):
    def __init__(self, value: Any) -> None:
        super().__init__("workflow interrupted")
        self.value = value


def interrupt(value: Any) -> Any:
    """在未提供 resume 时抛出中断；恢复时返回传入决策。"""

    if _HAS_RESUME.get():
        return _RESUME_VALUE.get()
    raise InterruptSignal(value)


def set_resume_value(value: Any) -> tuple[object, object]:
    token_value = _RESUME_VALUE.set(value)
    token_flag = _HAS_RESUME.set(True)
    return token_value, token_flag


def clear_resume_value(tokens: tuple[object, object]) -> None:
    token_value, token_flag = tokens
    _RESUME_VALUE.reset(token_value)
    _HAS_RESUME.reset(token_flag)

