from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.role_catalog import get_agent_role, is_role_allowed_tool, list_subagent_roles
from app.domains.agent_runs.trace import AgentToolTrace

ToolHandler = Callable[["ToolExecutionContext", dict[str, Any]], "ToolResult"]


@dataclass(frozen=True)
class ToolCatalogReferences:
    page_refs: Sequence[str] = field(default_factory=tuple)
    api_paths: Sequence[str] = field(default_factory=tuple)
    workflow_nodes: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class AgentRuntimeToolSpec:
    name: str
    description: str
    domain: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any]
    allowed_roles: Sequence[str]
    permission_level: str
    risk_level: str
    requires_confirmation: bool
    retry_safe: bool
    idempotent: bool
    execution_mode: str
    artifact_kinds: Sequence[str] = field(default_factory=tuple)
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    evidence_fields: Sequence[str] = field(default_factory=tuple)
    references: ToolCatalogReferences = field(default_factory=ToolCatalogReferences)


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


_REVIEWER_ROLES = ("plot_reviewer", "character_reviewer", "prose_reviewer", "continuity_reviewer")
_REVIEW_ALLOWED_ROLES = ("root_agent", *_REVIEWER_ROLES, "repair_agent", "synthesizer")
_CONTEXT_ALLOWED_ROLES = (*_REVIEW_ALLOWED_ROLES, "context_explorer")
_WRITE_ALLOWED_ROLES = ("root_agent", "repair_agent")
_BOOKRUN_ALLOWED_ROLES = ("root_agent", "bookrun_agent")

_AGENT_RUNTIME_TOOL_SPECS: tuple[AgentRuntimeToolSpec, ...] = (
    AgentRuntimeToolSpec(
        name="context.load",
        description="读取当前文件与上下文摘要。",
        domain="context",
        input_schema={},
        output_schema={},
        allowed_roles=_CONTEXT_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="read",
        requires_confirmation=False,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("file_path", "context_file_count", "context_kinds"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.context_load",)),
    ),
    AgentRuntimeToolSpec(
        name="fs.list",
        description="列出项目目录内文件（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        permission_level="auto",
        risk_level="read",
        requires_confirmation=False,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("entry_count", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_list",)),
    ),
    AgentRuntimeToolSpec(
        name="fs.read",
        description="读取项目内单个文本文件切片（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        permission_level="auto",
        risk_level="read",
        requires_confirmation=False,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "returned_chars", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_read",)),
    ),
    AgentRuntimeToolSpec(
        name="fs.search",
        description="在项目文本文件里跨文件检索（path-scoped 只读）。",
        domain="fs",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        permission_level="auto",
        risk_level="read",
        requires_confirmation=False,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("match_count", "truncated"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.fs_search",)),
    ),
    AgentRuntimeToolSpec(
        name="project.consistency",
        description="项目级一致性观察扫描：词条出现分布、时间标记、跨文件重复子句（path-scoped 只读，不下结论）。",
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        permission_level="auto",
        risk_level="read",
        requires_confirmation=False,
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("scanned_files", "term_count", "time_marker_count", "repeated_clause_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_consistency",)),
    ),
    AgentRuntimeToolSpec(
        name="project.deep_consistency",
        description="深度一致性评审：语义 judge 对照本地人物 / 设定文件检查单个稿件，产出 advisory issue 信号（不写盘、不落 DB）。",
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        permission_level="auto",
        risk_level="analyze",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        required_capabilities=("llm",),
        evidence_fields=("path", "issue_count", "bible_file_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_deep_consistency",)),
    ),
    AgentRuntimeToolSpec(
        name="file.review",
        description="执行 chapter_polish 多子代理审稿。",
        domain="review",
        input_schema={},
        output_schema={},
        allowed_roles=_REVIEW_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="analyze",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("review_report",),
        required_capabilities=("llm",),
        evidence_fields=("issue_count", "mode", "review_report"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_review",)),
    ),
    AgentRuntimeToolSpec(
        name="file.revise",
        description="生成待确认文件修订补丁。",
        domain="file",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        permission_level="confirm",
        risk_level="write_pending",
        requires_confirmation=True,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "applied_scope", "scope_warning"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_revise",)),
    ),
    AgentRuntimeToolSpec(
        name="file.create",
        description="为尚不存在的新文件起草初稿，生成待确认新建文件补丁。",
        domain="file",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        permission_level="confirm",
        risk_level="write_pending",
        requires_confirmation=True,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        required_capabilities=("llm",),
        evidence_fields=("proposed_patch", "content_chars"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.file_create",)),
    ),
    AgentRuntimeToolSpec(
        name="judge.run",
        description="对生成内容执行轻量检查。",
        domain="judge",
        input_schema={},
        output_schema={},
        allowed_roles=_REVIEW_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="analyze",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        evidence_fields=("issue_count", "mode"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.judge_run",)),
    ),
    AgentRuntimeToolSpec(
        name="judge.repair",
        description="通过 IDE command registry 生成 Judge 修复。",
        domain="judge",
        input_schema={},
        output_schema={},
        allowed_roles=_WRITE_ALLOWED_ROLES,
        permission_level="confirm",
        risk_level="write_pending",
        requires_confirmation=True,
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        artifact_kinds=("proposed_patch",),
        evidence_fields=("repair_patch", "audit_event_id"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/judge.repair",),
            workflow_nodes=("agent_runtime.judge_repair",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.start",
        description="启动 managed 写作任务。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        permission_level="confirm",
        risk_level="long_running",
        requires_confirmation=True,
        retry_safe=False,
        idempotent=False,
        execution_mode="long_running",
        artifact_kinds=("bookrun_checkpoint",),
        evidence_fields=("book_run_id", "writing_run_id", "checkpoint"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.start",),
            workflow_nodes=("agent_runtime.bookrun_start",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.pause",
        description="执行 bookrun.pause 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="long_running",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "status"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.pause",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.resume",
        description="执行 bookrun.resume 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="long_running",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "status"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.resume",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
    AgentRuntimeToolSpec(
        name="bookrun.retry_from_checkpoint",
        description="执行 bookrun.retry_from_checkpoint 控制命令。",
        domain="bookrun",
        input_schema={},
        output_schema={},
        allowed_roles=_BOOKRUN_ALLOWED_ROLES,
        permission_level="auto",
        risk_level="long_running",
        requires_confirmation=False,
        retry_safe=False,
        idempotent=False,
        execution_mode="control",
        evidence_fields=("book_run_id", "checkpoint"),
        references=ToolCatalogReferences(
            api_paths=("POST /api/ide/commands/bookrun.retry_from_checkpoint",),
            workflow_nodes=("agent_runtime.bookrun_control",),
        ),
    ),
)


def list_agent_runtime_tool_specs() -> tuple[AgentRuntimeToolSpec, ...]:
    return _AGENT_RUNTIME_TOOL_SPECS


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
class ToolResult:
    status: str
    output: dict[str, Any]
    trace: AgentToolTrace
    summary: str | None = None
    payload: dict[str, Any] | None = None
    artifacts: tuple[ToolArtifact, ...] = ()
    metrics: dict[str, Any] = field(default_factory=dict)
    retry_metadata: dict[str, Any] | None = None
    checkpoint_metadata: dict[str, Any] | None = None


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
class PermissionDecision:
    status: str
    reason: str


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


class PermissionGate:
    """Runtime tool execution gate with the v1 permission profiles."""

    _RISKY_LEVELS = frozenset({"propose_patch", "write_pending", "long_running", "network", "high_cost"})

    def decide(self, run: AgentRun, tool: ToolDefinition) -> PermissionDecision:
        profile = run.permission_profile or "risk_confirm"
        if profile == "full_allow":
            return PermissionDecision("allow", "full_allow")
        if profile == "autonomous_approval" and tool.risk_level not in {"write_pending", "high_cost"}:
            return PermissionDecision("allow", "autonomous_approval")
        if profile == "risk_confirm" and tool.risk_level not in self._RISKY_LEVELS and not tool.requires_confirmation:
            return PermissionDecision("allow", "risk_confirm_safe_tool")
        if profile == "step_confirm" or tool.requires_confirmation or tool.risk_level in self._RISKY_LEVELS:
            return PermissionDecision("require_approval", f"{profile}:{tool.risk_level}")
        return PermissionDecision("allow", profile)


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
