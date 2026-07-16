from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.domains.agent_runs.schemas import AgentRoleRead

DEFAULT_PERMISSION_PROFILE = "risk_confirm"
READ_ONLY_ROLE_FORBIDDEN_TOOLS = frozenset({"file.revise", "judge.repair", "bookrun.start"})

_AGENT_ROLE_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "root_agent",
        "display_name": "Root Agent",
        "kind": "primary",
        "description": "用户直接交互的主代理，负责理解目标、制定计划、调度子代理、执行权限检查和汇总结果。",
        "aliases": [],
        "read_only": False,
        "default_permission_profile": DEFAULT_PERMISSION_PROFILE,
        "allowed_tools": [
            "context.load",
            "fs.list",
            "fs.read",
            "fs.search",
            "project.consistency",
            "project.prose_check",
            "project.collapse_check",
            "project.entity_budget_check",
            "project.deep_consistency",
            "project.canon",
            "project.canon_delta",
            "project.promise_check",
            "project.hooks_delta",
            "project.trim_prose",
            "file.review",
            "file.revise",
            "file.create",
            "judge.run",
            "judge.repair",
            "bookrun.start",
            "bookrun.pause",
            "bookrun.resume",
            "bookrun.retry_from_checkpoint",
        ],
        "output_artifacts": ["review_report", "proposed_patch", "chapter_draft", "bookrun_checkpoint"],
        "can_be_mentioned": False,
    },
    {
        "name": "plot_reviewer",
        "display_name": "剧情 reviewer",
        "kind": "subagent",
        "description": "检查剧情结构、冲突、钩子、节奏和主线推进。",
        "aliases": ["@剧情"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "character_reviewer",
        "display_name": "人物 reviewer",
        "kind": "subagent",
        "description": "检查人物动机、称谓、关系、人设一致性和行为可信度。",
        "aliases": ["@人物"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "prose_reviewer",
        "display_name": "文风 reviewer",
        "kind": "subagent",
        "description": "检查文风、表达、信息密度、爽感和移动端阅读节奏。",
        "aliases": ["@文风"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "continuity_reviewer",
        "display_name": "连续性 reviewer",
        "kind": "subagent",
        "description": "检查设定、伏笔、人物关系、时间线和前后文事实冲突。",
        "aliases": ["@伏笔", "@设定"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "repair_agent",
        "display_name": "修复 agent",
        "kind": "subagent",
        "description": "根据审稿结论生成 proposed patch，并在写回前等待作者确认。",
        "aliases": ["@修复"],
        "read_only": False,
        "default_permission_profile": DEFAULT_PERMISSION_PROFILE,
        "allowed_tools": ["context.load", "file.review", "file.revise", "project.trim_prose", "judge.run", "judge.repair"],
        "output_artifacts": ["proposed_patch", "review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "synthesizer",
        "display_name": "Synthesizer",
        "kind": "subagent",
        "description": "合并多个 reviewer 的发现，形成统一审稿报告和修订策略。",
        "aliases": [],
        "read_only": False,
        "default_permission_profile": DEFAULT_PERMISSION_PROFILE,
        "allowed_tools": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": False,
    },
    {
        "name": "bookrun_agent",
        "display_name": "Writing Run agent",
        "kind": "subagent",
        "description": "管理长程写作任务、checkpoint、暂停、恢复和从 checkpoint 重试。",
        "aliases": ["@写作任务"],
        "read_only": False,
        "default_permission_profile": DEFAULT_PERMISSION_PROFILE,
        "allowed_tools": ["bookrun.start", "bookrun.pause", "bookrun.resume", "bookrun.retry_from_checkpoint"],
        "output_artifacts": ["chapter_draft", "bookrun_checkpoint"],
        "can_be_mentioned": True,
    },
    {
        "name": "context_explorer",
        "display_name": "上下文探索 agent",
        "kind": "subagent",
        "description": "只读探索项目上下文、当前稿、相关设定和检索结果。",
        "aliases": ["@探索"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["context.load", "fs.list", "fs.read", "fs.search", "project.consistency", "project.prose_check", "project.collapse_check", "project.entity_budget_check", "project.canon", "project.canon_delta", "project.promise_check", "project.hooks_delta", "mcp.project.search", "mcp.context.inspect"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
    {
        "name": "external_scout",
        "display_name": "资料 scout",
        "kind": "subagent",
        "description": "只读检索外部资料或 MCP 结果，为 Root Agent 提供证据摘要。",
        "aliases": ["@资料"],
        "read_only": True,
        "default_permission_profile": "read",
        "allowed_tools": ["mcp.project.search", "mcp.context.inspect"],
        "output_artifacts": ["review_report"],
        "can_be_mentioned": True,
    },
)


@dataclass(frozen=True)
class AgentRoleHintNormalization:
    hints: list[str]
    mentions: list[str]
    unknown_hints: list[str]
    unknown_mentions: list[str]


class AgentRoleCatalogError(RuntimeError):
    """Agent role catalog 配置错误。"""


def list_agent_roles() -> list[AgentRoleRead]:
    """返回 Agent Runtime 只读角色目录。"""

    _validate_agent_role_catalog()
    return [AgentRoleRead.model_validate(role) for role in _AGENT_ROLE_DEFINITIONS]


def list_subagent_roles() -> list[AgentRoleRead]:
    """返回可被 Runtime 调度的 subagent roles。"""

    return [role for role in list_agent_roles() if role.kind == "subagent"]


def get_agent_role(name: str) -> AgentRoleRead | None:
    """按规范 role name 读取目录中的 role。"""

    _validate_agent_role_catalog()
    normalized_name = name.strip()
    if not normalized_name:
        return None
    for role in _AGENT_ROLE_DEFINITIONS:
        if normalized_name == role["name"]:
            return AgentRoleRead.model_validate(role)
    return None


def resolve_agent_role_alias(alias: str) -> AgentRoleRead | None:
    """根据用户输入的 @角色 alias 解析到目录中的 role。"""

    _validate_agent_role_catalog()
    normalized_alias = alias.strip()
    if not normalized_alias:
        return None
    for role in _AGENT_ROLE_DEFINITIONS:
        if normalized_alias == role["name"] or normalized_alias in role["aliases"]:
            return AgentRoleRead.model_validate(role)
    return None


def is_role_allowed_tool(role_name: str, tool_name: str) -> bool:
    """校验某个 role 是否允许调用对应 runtime tool。"""

    role = get_agent_role(role_name)
    return bool(role and tool_name in role.allowed_tools)


def normalize_agent_role_inputs(args: dict[str, Any]) -> AgentRoleHintNormalization:
    """把 Desktop 传来的 role names / mentions 归一化为可执行 role hints。"""

    raw_hints = _string_list(args.get("agent_role_hints"))
    raw_mentions = _string_list(args.get("agent_role_mentions"))
    hints: list[str] = []
    unknown_hints: list[str] = []
    for raw_hint in raw_hints:
        role = get_agent_role(raw_hint) or resolve_agent_role_alias(raw_hint)
        if role and role.can_be_mentioned:
            hints.append(role.name)
        else:
            unknown_hints.append(raw_hint)

    mentions: list[str] = []
    unknown_mentions: list[str] = []
    for mention in raw_mentions:
        mentions.append(mention)
        role = resolve_agent_role_alias(mention)
        if role and role.can_be_mentioned:
            hints.append(role.name)
        else:
            unknown_mentions.append(mention)

    return AgentRoleHintNormalization(
        hints=_ordered_unique(hints),
        mentions=_ordered_unique(mentions),
        unknown_hints=_ordered_unique(unknown_hints),
        unknown_mentions=_ordered_unique(unknown_mentions),
    )


def _validate_agent_role_catalog() -> None:
    primary_roles = [role for role in _AGENT_ROLE_DEFINITIONS if role["kind"] == "primary"]
    if len(primary_roles) != 1:
        raise AgentRoleCatalogError("Agent role catalog 必须且只能包含一个 primary role。")
    names = [str(role["name"]) for role in _AGENT_ROLE_DEFINITIONS]
    if len(names) != len(set(names)):
        raise AgentRoleCatalogError("Agent role catalog 存在重复 role name。")
    for role in _AGENT_ROLE_DEFINITIONS:
        if role["kind"] not in {"primary", "subagent"}:
            raise AgentRoleCatalogError(f"Agent role kind 不合法：{role['kind']}")
        allowed_tools = set(role["allowed_tools"])
        if role["read_only"] and not READ_ONLY_ROLE_FORBIDDEN_TOOLS.isdisjoint(allowed_tools):
            raise AgentRoleCatalogError(f"只读 Agent role 不能绑定写入工具：{role['name']}")


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result
