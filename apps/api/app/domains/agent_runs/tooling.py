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
    risk_level: str
    retry_safe: bool
    idempotent: bool
    execution_mode: str
    artifact_kinds: Sequence[str] = field(default_factory=tuple)
    required_capabilities: Sequence[str] = field(default_factory=tuple)
    evidence_fields: Sequence[str] = field(default_factory=tuple)
    references: ToolCatalogReferences = field(default_factory=ToolCatalogReferences)
    loop_schema: LoopToolSchema | None = None

    # permission_level / requires_confirmation 从 risk_level + execution_mode 单点派生，不再并列声明
    # （消除三字段漂移），派生规则见 derive_requires_confirmation。
    @property
    def requires_confirmation(self) -> bool:
        return derive_requires_confirmation(self.risk_level, self.execution_mode)

    @property
    def permission_level(self) -> str:
        return derive_permission_level(self.risk_level, self.execution_mode)


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
        risk_level="read",
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
        risk_level="read",
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
        risk_level="read",
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
        risk_level="read",
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
        risk_level="read",
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
        risk_level="analyze",
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
        name="project.canon",
        description=(
            "项目 canon 闸：从正文重建实体在场缓存 + 校验作者在 .storyforge/canon/canon.json "
            "声明的薄不变量（唯一持有 / 时间线先后 / 退场一致性），产出硬矛盾与 advisory 信号。"
            "会更新 .storyforge/canon/ 派生缓存（非手稿正文），不落 DB。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("entity_count", "checked_invariants", "conflict_count", "advisory_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_canon",)),
        loop_schema=LoopToolSchema(
            description=(
                "项目 canon 闸（确定性，无需 LLM）：从正文重建实体在场分布缓存，再校验作者声明的薄不变量——"
                "唯一持有（同一物件章节窗口内只能一个持有者）、时间线先后（声明不能成环）、"
                "退场一致性（声明退场后不应再出场）。返回硬矛盾（blocking，声明内部结构冲突）与 advisory "
                "（退场后仍出场，可能是回忆 / 提及 / 同名，须抽读核实）。它随书累积、比无状态深查更能抓跨章累积漂移。"
                "同时把每实体事实（身份 / 别名 / 出场跨度 / 绑定声明 / provenance）投影成人可读 dossier.md 缓存。"
                "调用会更新 .storyforge/canon/ 下的派生缓存（不改手稿）。作者尚未在 canon.json 声明不变量时，"
                "会建立空格式骨架并如实说明无可校验项。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "refresh": {
                        "type": "boolean",
                        "description": "是否强制从正文重建在场缓存，默认 true。",
                    },
                    "glob": {"type": "string", "description": "正文文件名过滤，默认 *.md。"},
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.canon_delta",
        description=(
            "确定性 canon 提案：把模型从正文观察到的实体、持有、退场和时间线声明与既有 canon 做归并、"
            "别名冲突与不变量差量检查，草稿只写派生 proposals.json；不写 canon.json 或手稿。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=(
            "new_entity_count",
            "known_entity_count",
            "alias_conflict_count",
            "new_conflict_count",
            "new_advisory_count",
        ),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_canon_delta",)),
        loop_schema=LoopToolSchema(
            description=(
                "canon 事实差量提案（确定性，无额外 LLM）：读完章节后，把观察到的实体、唯一持有、退场和"
                "时间线先后作为结构化参数传入。字段未传表示该类不提议；全空会诚实返回无提议。工具会归并"
                "既有实体、提示同名 / 别名身份冲突，并只报告提案新增的 canon 闸问题。合并草稿写入派生缓存 "
                "proposals.json，绝不修改 canon.json 或正文；作者审阅后再决定是否走待确认补丁。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "entities": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "aliases": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "required": ["name"],
                        },
                        "description": "本章观察到的实体；name 为主表面形，aliases 为可选别名。",
                    },
                    "holder_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "holder": {"type": "string"},
                                "from_chapter": {"type": "integer"},
                                "to_chapter": {"type": "integer"},
                            },
                            "required": ["item", "holder"],
                        },
                        "description": "本章观察到的唯一持有声明。",
                    },
                    "exit_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "entity": {"type": "string"},
                                "exits_after_chapter": {"type": "integer"},
                                "reason": {"type": "string"},
                            },
                            "required": ["entity", "exits_after_chapter"],
                        },
                        "description": "本章观察到的实体退场声明。",
                    },
                    "timeline_claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "before": {"type": "string"},
                                "after": {"type": "string"},
                            },
                            "required": ["before", "after"],
                        },
                        "description": "本章观察到的时间线先后声明。",
                    },
                },
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.prose_check",
        description=(
            "文笔气味静态检查：对单个稿件做确定性坏味道扫描（陈词套话 / 说明腔 / 情绪直述 / "
            "解释性旁白 / 对白密度 / 句长 / 重复表达 / 静态节奏），产出 advisory issue（无 LLM，不写盘）。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "issue_count", "dimension_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_prose_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "文笔气味静态检查（确定性，无需 LLM、不烧 token）：对项目内单个稿件扫描常见坏味道——"
                "陈词套话、直述情绪的说明腔、解释性旁白、对白密度失衡、超长句 / 短句堆叠、短窗口重复、"
                "缺少行动 beat 的静态节奏，返回带维度 / 严重度的 issue 列表。比 file_review 便宜得多，"
                "适合修订前先快速定位文笔问题；结果是参考信号，结合原文判断后再决定是否修改。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的稿件路径（要检查文笔的正文）。"},
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.collapse_check",
        description=(
            "场景承重静态检查：结合正文与模型抽取的结构化观察值，确定性标记 process-only、"
            "情绪零变化、无不可逆后果、可删除和调查模板风险；仅供 advisory 参考，不是质量判定。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "verdict", "issue_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_collapse_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "场景承重静态检查（确定性，无需额外 LLM、不写盘）：先读完正文，再把你从正文观察到的 beats、"
                "场景前后情绪、不可逆后果、是否可删除填入可选参数。未传字段会跳过对应规则；显式空串 / "
                "空数组表示观察结果为无。工具还会扫描正文调查模板，返回 pass / warn advisory 信号。"
                "结果只是辅助判断，不是场景质量结论。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的正文文件路径。"},
                    "beats": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "读完正文后提取的场景动作 beats；显式空数组表示没有 beats。",
                    },
                    "emotion_before": {
                        "type": "string",
                        "description": "场景开始时的情绪；显式空串表示没有可识别情绪。",
                    },
                    "emotion_after": {
                        "type": "string",
                        "description": "场景结束时的情绪；显式空串表示没有可识别情绪。",
                    },
                    "irreversible_consequence": {
                        "type": "string",
                        "description": "本场造成的不可逆后果；显式空串表示没有。",
                    },
                    "deletable": {
                        "type": "boolean",
                        "description": "删除本场后主线是否仍成立。",
                    },
                },
                "required": ["path"],
            },
        ),
    ),
    AgentRuntimeToolSpec(
        name="project.entity_budget_check",
        description=(
            "长篇实体预算静态检查：结合章节序号与模型从正文抽取的新增实体，确定性标记后期新增地点 / "
            "谜题 / 设备证据及关键人物、核心地点、核心证据、重大反转数量超预算；仅供 advisory 参考，"
            "不是质量判定。"
        ),
        domain="project",
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent", "context_explorer"),
        risk_level="read",
        retry_safe=True,
        idempotent=True,
        execution_mode="sync",
        evidence_fields=("path", "chapter", "verdict", "issue_count"),
        references=ToolCatalogReferences(workflow_nodes=("agent_runtime.project_entity_budget_check",)),
        loop_schema=LoopToolSchema(
            description=(
                "长篇实体预算检查（确定性，无需额外 LLM、不写盘）：先读完正文，再把本章观察到的新增关键人物、"
                "核心地点、核心证据、重大反转、谜题和装备填入可选数组。字段未传会跳过对应规则，显式空数组"
                "表示本章无该类新增。chapter 未传时按项目文件阅读序推断。返回 pass / warn advisory 信号，"
                "仅供结构规划参考，不是质量判定。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对项目根的正文文件路径。"},
                    "chapter": {
                        "type": "integer",
                        "description": "可选章节序号；未传时按项目文件阅读序推断。",
                    },
                    "new_key_characters": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增关键人物；显式空数组表示无新增。",
                    },
                    "new_core_locations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增核心地点；显式空数组表示无新增。",
                    },
                    "new_core_evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增核心证据；显式空数组表示无新增。",
                    },
                    "new_major_reversals": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增重大反转；显式空数组表示无新增。",
                    },
                    "new_mysteries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增谜题；显式空数组表示无新增。",
                    },
                    "new_equipment": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "本章新增装备或设备型号；显式空数组表示无新增。",
                    },
                    "budget_key_characters": {
                        "type": "integer",
                        "description": "关键人物数量预算覆盖，默认 5。",
                    },
                    "budget_core_locations": {
                        "type": "integer",
                        "description": "核心地点数量预算覆盖，默认 3。",
                    },
                    "budget_core_evidence": {
                        "type": "integer",
                        "description": "核心证据数量预算覆盖，默认 3。",
                    },
                    "budget_major_reversals": {
                        "type": "integer",
                        "description": "重大反转数量预算覆盖，默认 2。",
                    },
                    "budget_new_core_entities_after_chapter_20": {
                        "type": "integer",
                        "description": "第 20 章后新增核心实体预算覆盖，默认 0。",
                    },
                    "budget_new_mysteries_after_chapter_25": {
                        "type": "integer",
                        "description": "第 25 章后新增谜题预算覆盖，默认 0。",
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
        risk_level="analyze",
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
        risk_level="write_pending",
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
        risk_level="write_pending",
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
        risk_level="analyze",
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
        risk_level="write_pending",
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
        risk_level="long_running",
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
        risk_level="long_running",
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
        risk_level="long_running",
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
        risk_level="long_running",
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


# 需要作者确认的风险等级：产出待确认补丁 / 高成本 / 出网。long_running 单独判——它既覆盖
# bookrun.start（真启动 managed run，须确认）又覆盖 bookrun.pause/resume/retry（控制命令，
# execution_mode="control"，不确认），故 long_running 要连 execution_mode 一起看。
_CONFIRMING_RISK_LEVELS = frozenset({"write_pending", "high_cost", "propose_patch", "network"})


def derive_requires_confirmation(risk_level: str, execution_mode: str) -> bool:
    """从 risk_level + execution_mode 单点派生「是否需作者确认」。

    permission_level / requires_confirmation 此前与 risk_level 并列人工声明、彼此 100% 相关但
    可各自漂移；改由本函数派生，risk_level + execution_mode 成为唯一声明轴。
    """

    if risk_level in _CONFIRMING_RISK_LEVELS:
        return True
    return risk_level == "long_running" and execution_mode != "control"


def derive_permission_level(risk_level: str, execution_mode: str) -> str:
    """需确认即 confirm、否则 auto（agent_runtime 词表）。"""

    return "confirm" if derive_requires_confirmation(risk_level, execution_mode) else "auto"


def confirming_tool_names(
    specs: Sequence[AgentRuntimeToolSpec] | None = None,
) -> frozenset[str]:
    """需作者确认的工具名集合（派生 runtime._execute_tool 的放行名单，取代手写第 5 轨）。"""

    source = _AGENT_RUNTIME_TOOL_SPECS if specs is None else specs
    return frozenset(spec.name for spec in source if spec.requires_confirmation)


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
    """Runtime 工具执行 gate。

    live 入口 run.permission_profile 恒为默认 risk_confirm（前端只读回传、从不发送），此前的
    full_allow / autonomous_approval / step_confirm 三分支不可达，已删。read / 未知 profile 走末尾
    fallthrough 放行。对可达 profile（risk_confirm）gate 只判 allow / require_approval；真正的写回
    确认发生在 proposed_patch 工件层由前端完成（require_approval 对 requires_confirmation 工具会被
    runtime._execute_tool 放行去产出补丁，见该处）。
    """

    _RISKY_LEVELS = frozenset({"propose_patch", "write_pending", "long_running", "network", "high_cost"})

    def decide(self, run: AgentRun, tool: ToolDefinition) -> PermissionDecision:
        profile = run.permission_profile or "risk_confirm"
        if profile == "risk_confirm" and tool.risk_level not in self._RISKY_LEVELS and not tool.requires_confirmation:
            return PermissionDecision("allow", "risk_confirm_safe_tool")
        if tool.requires_confirmation or tool.risk_level in self._RISKY_LEVELS:
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
