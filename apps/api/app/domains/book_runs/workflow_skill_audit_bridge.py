"""跨边界桥接：在 API 审计报告中复用 workflow 技能链投影。"""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Mapping, Sequence, Set
from dataclasses import fields, is_dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any


def _skill_audit_file_path() -> Path:
    """定位相邻 workflow 技能审计事实源，避免导入 workflow 顶层运行时。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "skills" / "audit.py"


@lru_cache(maxsize=1)
def _load_skill_audit_module() -> ModuleType:
    """加载 workflow 技能审计纯函数模块。"""

    audit_path = _skill_audit_file_path()
    spec = importlib.util.spec_from_file_location("storyforge_workflow_skill_audit", audit_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 workflow 技能审计模块：{audit_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def derive_book_run_skill_chain(book_run_id: int, status: str, progress: Mapping[str, Any]) -> dict[str, Any]:
    """把 BookRun progress 转成 audit_report.json 可序列化的技能链。"""

    projection = _load_skill_audit_module().derive_skill_chain_projection(book_run_id, status, progress)
    return _to_jsonable(projection)


def _to_jsonable(value: object) -> Any:
    """递归转换 dataclass 与冻结容器，输出 JSON 友好的 Python 值。"""

    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: _to_jsonable(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, Mapping):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Set):
        return [_to_jsonable(item) for item in sorted(value, key=str)]
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_to_jsonable(item) for item in value]
    return value
