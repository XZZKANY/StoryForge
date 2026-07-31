from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.role_catalog import get_agent_role, is_role_allowed_tool, list_subagent_roles
from app.domains.agent_runs.tools.spec_models import AgentRuntimeToolSpec
from app.domains.agent_runs.trace import AgentToolTrace

if TYPE_CHECKING:
    from app.domains.agent_runs.patches.types import PatchProposal

ToolOutputT = TypeVar("ToolOutputT", bound=dict[str, Any])
ToolHandler = Callable[["ToolExecutionContext", dict[str, Any]], "ToolResult[dict[str, Any]]"]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    allowed_roles: tuple[str, ...]
    permission_level: str
    risk_level: str
    requires_confirmation: bool
    retry_safe: bool
    idempotent: bool
    execution_mode: str
    artifact_kinds: tuple[str, ...]
    handler: ToolHandler


def tool_definition_from_spec(spec: AgentRuntimeToolSpec, handler: ToolHandler) -> ToolDefinition:
    return ToolDefinition(
        name=spec.name,
        description=spec.description,
        input_schema=dict(spec.input_schema),
        output_schema=dict(spec.output_schema),
        allowed_roles=tuple(spec.allowed_roles),
        permission_level=spec.permission_level,
        risk_level=spec.risk_level,
        requires_confirmation=spec.requires_confirmation,
        retry_safe=spec.retry_safe,
        idempotent=spec.idempotent,
        execution_mode=spec.execution_mode,
        artifact_kinds=tuple(spec.artifact_kinds),
        handler=handler,
    )


@dataclass(frozen=True)
class ToolResult(Generic[ToolOutputT]):
    status: str
    output: ToolOutputT
    trace: AgentToolTrace
    summary: str | None = None
    payload: dict[str, Any] | None = None
    artifacts: tuple[ToolArtifact, ...] = ()
    metrics: dict[str, Any] = field(default_factory=dict)
    retry_metadata: dict[str, Any] | None = None
    checkpoint_metadata: dict[str, Any] | None = None
    patch_proposal: PatchProposal | None = None


@dataclass(frozen=True)
class ToolArtifact:
    kind: str
    payload: dict[str, Any]
    requires_confirmation: bool = False


@dataclass
class ToolExecutionContext:
    session: Session
    run: AgentRun
    agent_session_id: str
    assistant_session_id: int
    user_message: str
    args: dict[str, Any]


@dataclass(frozen=True)
class SubagentDefinition:
    role: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], dict[str, Any]]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition) -> None:
        self._tools[definition.name] = definition

    def get(self, name: str) -> ToolDefinition:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise AgentOrchestrationError(f"Agent Runtime 工具未注册：{name}") from exc

    def all(self) -> tuple[ToolDefinition, ...]:
        return tuple(self._tools.values())


class SubagentExecutor:
    def __init__(self, definitions: list[SubagentDefinition]) -> None:
        self._definitions = {definition.role: definition for definition in definitions}
        known_subagent_roles = {role.name for role in list_subagent_roles()}
        missing_roles = [definition.role for definition in definitions if definition.role not in known_subagent_roles]
        if missing_roles:
            raise AgentOrchestrationError(f"子代理未登记到 role catalog：{', '.join(missing_roles)}")

    @property
    def roles(self) -> list[str]:
        return list(self._definitions)

    def run(self, role: str, payload: dict[str, Any], *, tool_name: str) -> dict[str, Any]:
        catalog_role = get_agent_role(role)
        if catalog_role is None or catalog_role.kind != "subagent":
            raise AgentOrchestrationError(f"未知子代理 role catalog 条目：{role}")
        if not is_role_allowed_tool(role, tool_name):
            raise AgentOrchestrationError(f"子代理 {role} 不允许调用工具 {tool_name}")
        try:
            definition = self._definitions[role]
        except KeyError as exc:
            raise AgentOrchestrationError(f"未知子代理：{role}") from exc
        return definition.handler(payload)
