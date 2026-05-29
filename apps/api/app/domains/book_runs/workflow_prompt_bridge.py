"""跨边界桥接：在 API 进程内复用 workflow 的纯函数 prompt 构建器。

API venv 没有 langgraph，且 storyforge_workflow 顶层 __init__ 会 import graph，
直接 import 会炸。这里仿照 runtime_tools 的做法，按文件路径加载 prompts 子模块，
并预置 stub 父包，使 builder/context 内部的绝对导入可解析，而不触发顶层运行时依赖。
"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any


def _prompts_dir() -> Path:
    """定位相邻 workflow prompts 目录。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "prompts"


def _load_file_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 prompt 模块：{path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def _load_prompt_layer() -> tuple[ModuleType, ModuleType]:
    """加载 builder 与 context 模块，返回 (builder, context)。"""

    prompts_dir = _prompts_dir()
    if "storyforge_workflow" not in sys.modules:
        pkg = ModuleType("storyforge_workflow")
        pkg.__path__ = [str(prompts_dir.parent)]
        sys.modules["storyforge_workflow"] = pkg
    if "storyforge_workflow.prompts" not in sys.modules:
        prompts_pkg = ModuleType("storyforge_workflow.prompts")
        prompts_pkg.__path__ = [str(prompts_dir)]
        sys.modules["storyforge_workflow.prompts"] = prompts_pkg
    _load_file_module("storyforge_workflow.prompts.models", prompts_dir / "models.py")
    context = _load_file_module("storyforge_workflow.prompts.context", prompts_dir / "context.py")
    builder = _load_file_module("storyforge_workflow.prompts.builder", prompts_dir / "builder.py")
    return builder, context


def build_draft_prompt_from_state(state: Mapping[str, Any], *, preview_chars: int = 120) -> str:
    """把注入键字典编译成可批准正文的分层 prompt。"""

    builder, context = _load_prompt_layer()
    ctx = context.narrative_context_from_state(dict(state))
    return builder.build_draft_prompt(ctx, preview_chars=preview_chars)
