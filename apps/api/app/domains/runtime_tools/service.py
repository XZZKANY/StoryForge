from __future__ import annotations

import importlib.util
import sys
from collections.abc import Mapping, Sequence, Set
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from app.domains.runtime_tools.schemas import RuntimeToolRead, RuntimeToolReferencesRead


def _registry_file_path() -> Path:
    """定位相邻 workflow registry 文件，避免导入 workflow 顶层运行时依赖。"""

    apps_dir = Path(__file__).resolve().parents[4]
    return apps_dir / "workflow" / "storyforge_workflow" / "tools" / "registry.py"


@lru_cache(maxsize=1)
def _load_registry_module() -> ModuleType:
    """从真实 registry.py 加载工具事实源，不触发 workflow 包顶层导入。"""

    registry_path = _registry_file_path()
    spec = importlib.util.spec_from_file_location("storyforge_runtime_tools_registry", registry_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 CreativeToolRegistry：{registry_path}")
    module = importlib.util.module_from_spec(spec)
    sys_modules_name = spec.name
    sys.modules[sys_modules_name] = module
    spec.loader.exec_module(module)
    return module


def _load_creative_tools():
    """延迟读取 workflow registry，避免 API 复制工具清单。"""

    return _load_registry_module().list_creative_tools()


def _to_jsonable(value: object) -> Any:
    """递归转换冻结容器，输出 FastAPI 可序列化的 JSON 值。"""

    if isinstance(value, Mapping):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, Set):
        return [_to_jsonable(item) for item in sorted(value, key=str)]
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_to_jsonable(item) for item in value]
    return value


def list_runtime_tools() -> list[RuntimeToolRead]:
    """返回 CreativeToolRegistry 派生的运行时工具列表。"""

    runtime_tools: list[RuntimeToolRead] = []
    for tool in _load_creative_tools():
        runtime_tools.append(
            RuntimeToolRead(
                name=tool.name,
                domain=tool.domain,
                input_schema=_to_jsonable(tool.input_schema),
                output_schema=_to_jsonable(tool.output_schema),
                required_capabilities=list(tool.required_capabilities),
                evidence_fields=list(tool.evidence_fields),
                references=RuntimeToolReferencesRead(
                    page_refs=list(tool.references.page_refs),
                    api_paths=list(tool.references.api_paths),
                    workflow_nodes=list(tool.references.workflow_nodes),
                ),
            )
        )
    return runtime_tools
