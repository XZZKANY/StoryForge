from __future__ import annotations

from app.common.exceptions import ConflictError, InputError


class StoryMemoryInputError(InputError):
    """长效记忆输入引用不存在或区间非法时抛出。"""


class ForeshadowLifecycleTransitionError(InputError):
    """伏笔生命周期转换不符合状态机时抛出。"""


class ForeshadowLifecycleConflictError(ConflictError):
    """伏笔生命周期已处于终态或重复转换时抛出。"""
