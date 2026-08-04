from __future__ import annotations

from collections.abc import Iterable

from app.platform.ai_sdk.contracts import ToolSpec
from app.platform.ai_sdk.tools.models import RuntimeTool


class ToolRegistryError(LookupError):
    pass


class ToolRegistry:
    def __init__(self, tools: Iterable[RuntimeTool] = ()) -> None:
        self._tools: dict[str, RuntimeTool] = {}
        for tool in tools:
            self.register(tool)

    def register(self, tool: RuntimeTool) -> None:
        if tool.spec.name in self._tools:
            raise ToolRegistryError(f"Runtime tool {tool.spec.name!r} is already registered.")
        self._tools[tool.spec.name] = tool

    def get(self, name: str) -> RuntimeTool:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise ToolRegistryError(f"Unknown runtime tool: {name}") from exc

    def all(self) -> tuple[RuntimeTool, ...]:
        return tuple(self._tools.values())

    def specs(self) -> tuple[ToolSpec, ...]:
        return tuple(tool.spec for tool in self._tools.values())
