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
class LoopToolSchema:
    """chat 自由文本循环暴露给 LLM 的 function 描述与参数 schema。

    带此字段的 spec 即「进 chat 循环、对 LLM 可见」的工具；不带（None）的工具（context.load /
    judge.* / bookrun.*）只走固定管线或控制通道，不进循环。LLM 面的 name / 描述 / 参数从这里
    单点派生（见 build_loop_tool_schemas），删掉 loop_runtime 里那份手写镜像。
    """

    description: str
    parameters: Mapping[str, Any]


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
    loop_schema: LoopToolSchema | None = None


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
        loop_schema=LoopToolSchema(
            description="列出项目内文件（递归、相对路径）。可选 subpath 限定子目录。",
            parameters={
                "type": "object",
                "properties": {
                    "subpath": {"type": "string", "description": "限定列出的子目录，相对项目根。"},
                },
            },
        ),
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
        loop_schema=LoopToolSchema(
            description="读取项目内单个文本文件的内容切片。",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的文件路径。"},
                    "offset": {"type": "integer", "description": "起始字符偏移，默认 0。"},
                    "limit": {"type": "integer", "description": "最多返回字符数，默认 20000。"},
                },
                "required": ["path"],
            },
        ),
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
        loop_schema=LoopToolSchema(
            description="在项目文本文件里跨文件检索，返回文件、行号和摘录。",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "要检索的文本或正则。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                    "use_regex": {"type": "boolean", "description": "query 是否按正则解释，默认 false。"},
                },
                "required": ["query"],
            },
        ),
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
        loop_schema=LoopToolSchema(
            description=(
                "项目级一致性观察扫描：给定人物名 / 称谓 / 设定词条，返回各文件出现分布（含从未出现的缺席词条）、"
                "全书时间标记罗列和跨文件重复子句。只报机械观察不下结论，用于称谓 / 时间线 / 重复表达检查。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "terms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要追踪的人物名 / 称谓 / 设定词条，最多 30 个；可先读设定文件再决定。",
                    },
                    "subpath": {"type": "string", "description": "限定扫描的子目录，相对项目根。"},
                    "glob": {"type": "string", "description": "文件名过滤，默认 *.md。"},
                },
            },
        ),
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
        # 虽是纯读无副作用，但每次调用真实烧 LLM token 且输出非严格确定：
        # 有意禁自动重试——瞬时失败作为工具错误反馈进循环，由模型/作者决定是否再试。
        retry_safe=False,
        idempotent=False,
        execution_mode="sync",
        required_capabilities=("llm",),
        evidence_fields=("path", "issue_count", "bible_file_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_deep_consistency",)),
        loop_schema=LoopToolSchema(
            description=(
                "深度一致性评审（语义）：把单个稿件对照项目内人物 / 设定文件交给语义评审模型，"
                "返回结构化 issue（类别 / 严重度 / 行号 / 摘要）。比 project_consistency 更贵更慢，"
                "适合先用机械观察或检索定位疑点、再对目标章节深查；结果是参考信号，须抽读原文核实。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径（要评审的正文）。"},
                    "bible_paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "作为约束的人物 / 设定文件路径；省略则自动取 人物/ 与 设定/ 下的 md 文件。",
                    },
                    "facts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "已核实的必含事实（如「左臂受伤」「地点：灯塔港」），正文与之矛盾会被标出；最多 40 条。",
                    },
                },
                "required": ["path"],
            },
        ),
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
        loop_schema=LoopToolSchema(
            description="对项目内单个稿件做多视角审稿（剧情 / 人物 / 文风 / 连续性），返回带稳定 id 的 issue 列表。",
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                },
                "required": ["path"],
            },
        ),
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
        loop_schema=LoopToolSchema(
            description=(
                "按明确指示修订项目内单个稿件，生成待作者确认的修订补丁；不会直接写盘。"
                "一次对话最多修订一个文件，修订前建议先 fs_read 或 file_review。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径。"},
                    "instruction": {"type": "string", "description": "修订指示：要改什么、保留什么。"},
                },
                "required": ["path", "instruction"],
            },
        ),
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
        loop_schema=LoopToolSchema(
            description=(
                "为项目内尚不存在的新文件起草完整初稿，生成待作者确认的新建文件补丁；不会直接写盘。"
                "目标文件已存在时会失败（改用 file_revise）；起草前建议先读大纲 / 设定 / 相邻章节。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的新文件路径（含目录与 .md 扩展名）。"},
                    "instruction": {"type": "string", "description": "写作指令：写什么、篇幅、衔接哪些既有内容。"},
                },
                "required": ["path", "instruction"],
            },
        ),
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


def llm_tool_name(spec_name: str) -> str:
    """dotted registry 名 → OpenAI function 名（function 名不允许点号）。"""

    return spec_name.replace(".", "_")


def list_loop_tool_specs(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> tuple[AgentRuntimeToolSpec, ...]:
    """进 chat 循环、对 LLM 可见的工具（带 loop_schema），按声明顺序。

    specs 省略则取全量注册表；元测试可传入含 demo 工具的列表验证单点派生。
    """

    source = _AGENT_RUNTIME_TOOL_SPECS if specs is None else specs
    return tuple(spec for spec in source if spec.loop_schema is not None)


def build_loop_tool_schemas(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> list[dict[str, Any]]:
    """从 spec 单点派生 chat 循环的 OpenAI function schema 列表（替代手写镜像）。"""

    schemas: list[dict[str, Any]] = []
    for spec in list_loop_tool_specs(specs):
        assert spec.loop_schema is not None  # list_loop_tool_specs 已过滤
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": llm_tool_name(spec.name),
                    "description": spec.loop_schema.description,
                    "parameters": dict(spec.loop_schema.parameters),
                },
            }
        )
    return schemas


def build_loop_tool_name_map(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> dict[str, str]:
    """OpenAI function 名 → dotted registry 名。"""

    return {llm_tool_name(spec.name): spec.name for spec in list_loop_tool_specs(specs)}


def loop_patch_tool_specs(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> tuple[AgentRuntimeToolSpec, ...]:
    """循环内会产出待确认补丁的工具（write_pending）：一次对话最多一个补丁，生成后撤下。"""

    return tuple(spec for spec in list_loop_tool_specs(specs) if spec.risk_level == "write_pending")


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
