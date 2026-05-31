"""跨边界复用 workflow 的技能链审计纯函数。"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any


def _audit_file_path() -> Path:
    """定位 workflow skills/audit.py，避免复制审计派生规则。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "skills" / "audit.py"


@lru_cache(maxsize=1)
def _load_audit_module() -> ModuleType:
    """按文件路径加载 audit 模块，绕开 workflow 顶层运行时依赖。"""

    audit_path = _audit_file_path()
    spec = importlib.util.spec_from_file_location("storyforge_workflow_skills_audit_bridge", audit_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载技能链审计模块：{audit_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def derive_book_run_skill_chain(progress: Mapping[str, Any]) -> dict[str, Any]:
    """从 BookRun progress 派生技能链摘要。"""

    return _load_audit_module().derive_skill_chain_summary(progress)
