from __future__ import annotations

from typing import Any

from app.domains.agent_runs.role_catalog import DEFAULT_PERMISSION_PROFILE
from app.domains.agent_runs.schemas import AgentSkillRead

_AGENT_SKILL_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "name": "chapter_polish",
        "description": "单章润色闭环：加载上下文、多视角审稿、生成 proposed patch，并等待作者确认写回。",
        "trigger_intents": ["file.review", "file.revise", "chapter.review", "chapter.repair"],
        "plan_template": [
            {"step": "context.load", "detail": "读取当前章与项目上下文。", "status": "planned"},
            {"step": "subagents.review", "detail": "剧情、人物、文风和连续性子代理并行审稿。", "status": "planned"},
            {"step": "repair.propose", "detail": "将审稿结论综合为 proposed patch。", "status": "planned"},
            {"step": "permission.confirm", "detail": "文件写回前等待作者确认。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "file.review", "file.revise", "judge.run", "judge.repair"],
        "output_artifacts": ["review_report", "proposed_patch"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "short_story_draft",
        "description": "短篇创作流程：根据故事核、情绪钩子和目标读者生成可审稿初稿。",
        "trigger_intents": ["chat.explain"],
        "plan_template": [
            {"step": "brief.extract", "detail": "提取题材、主角、冲突和结尾反转。", "status": "planned"},
            {"step": "draft.write", "detail": "按短篇节奏生成完整初稿。", "status": "planned"},
            {"step": "judge.run", "detail": "检查情绪推进、反转和可读性。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "judge.run"],
        "output_artifacts": ["chapter_draft", "review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "long_chapter_generate",
        "description": "长篇章节生成流程：按蓝图、Scene Packet 和连续性约束产出新章节草稿。",
        "trigger_intents": ["chat.explain", "chapter.review"],
        "plan_template": [
            {"step": "context.load", "detail": "读取蓝图、章节目标和连续性资料。", "status": "planned"},
            {"step": "chapter.generate", "detail": "生成章节草稿并保留证据链。", "status": "planned"},
            {"step": "judge.run", "detail": "审查事实、节奏和设定一致性。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "scene_packets.assemble", "judge.run"],
        "output_artifacts": ["chapter_draft", "review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "consistency_review",
        "description": "一致性审查流程：聚焦设定、伏笔、人物关系、时间线和前后文事实冲突。",
        "trigger_intents": ["file.review", "chapter.review"],
        "plan_template": [
            {"step": "context.load", "detail": "读取当前稿和相关事实资料。", "status": "planned"},
            {"step": "continuity.review", "detail": "检查设定、伏笔、人物关系和时间线。", "status": "planned"},
            {"step": "synthesizer.merge", "detail": "合并冲突证据与修订建议。", "status": "planned"},
        ],
        "tool_sequence": ["context.load", "file.review", "judge.run"],
        "output_artifacts": ["review_report"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
    {
        "name": "bookrun_generation",
        "description": "managed Writing Run 长任务流程：按 checkpoint 推进长篇写作、暂停、恢复和失败重试。",
        "trigger_intents": ["bookrun.start"],
        "plan_template": [
            {"step": "bookrun.preflight", "detail": "确认蓝图、预算和章节范围。", "status": "planned"},
            {"step": "bookrun.start", "detail": "启动 managed Writing Run。", "status": "planned"},
            {"step": "bookrun.checkpoint", "detail": "每章生成后写入事件和 checkpoint。", "status": "planned"},
            {"step": "bookrun.resume", "detail": "支持暂停、恢复和从 checkpoint 重试。", "status": "planned"},
        ],
        "tool_sequence": ["bookrun.start", "bookrun.pause", "bookrun.resume", "bookrun.retry_from_checkpoint"],
        "output_artifacts": ["chapter_draft", "bookrun_checkpoint"],
        "permission_profile": DEFAULT_PERMISSION_PROFILE,
    },
)


def list_agent_skills() -> list[AgentSkillRead]:
    """返回 Root Agent 可选择的静态流程 skill 清单。"""

    return [AgentSkillRead.model_validate(skill) for skill in _AGENT_SKILL_DEFINITIONS]


def _skill_by_name(name: str) -> dict[str, Any]:
    for skill in _AGENT_SKILL_DEFINITIONS:
        if skill["name"] == name:
            return skill
    raise KeyError(f"Agent skill 不存在：{name}")


def _agent_plan_payload(
    *,
    intent: object,
    goal: str,
    scope: dict[str, Any] | None,
    plan: list[dict[str, Any]],
) -> dict[str, Any]:
    selected_skill = _select_agent_skill(intent, goal, scope)
    return {
        "intent": intent,
        "plan": plan,
        "agent_role_hints": _scope_string_list(scope, "agent_role_hints"),
        "agent_role_mentions": _scope_string_list(scope, "agent_role_mentions"),
        "skill_version": "skills_v1",
        "selected_skill": {
            "name": selected_skill["name"],
            "description": selected_skill["description"],
            "permission_profile": selected_skill["permission_profile"],
            "tool_sequence": list(selected_skill["tool_sequence"]),
            "output_artifacts": list(selected_skill["output_artifacts"]),
        },
        "skill_plan_template": list(selected_skill["plan_template"]),
    }


def _select_agent_skill(intent: object, goal: str, scope: dict[str, Any] | None) -> dict[str, Any]:
    normalized_intent = intent if isinstance(intent, str) else ""
    text = goal.lower()
    if normalized_intent == "bookrun.start":
        return _skill_by_name("bookrun_generation")
    if normalized_intent in {"file.revise", "chapter.repair"}:
        return _skill_by_name("chapter_polish")
    if normalized_intent in {"file.review", "chapter.review"}:
        if any(keyword in goal for keyword in ("一致性", "设定", "伏笔", "时间线", "前后文", "连续性")):
            return _skill_by_name("consistency_review")
        return _skill_by_name("chapter_polish")
    if any(keyword in goal for keyword in ("短篇", "盐言", "故事核", "反转")):
        return _skill_by_name("short_story_draft")
    if any(keyword in goal for keyword in ("生成章节", "写一章", "续写", "long chapter")) or _has_scope_key(
        scope,
        "scene_packet_id",
        "book_id",
        "blueprint_id",
    ):
        return _skill_by_name("long_chapter_generate")
    if "consistency" in text:
        return _skill_by_name("consistency_review")
    return _skill_by_name("chapter_polish")


def _has_scope_key(scope: dict[str, Any] | None, *keys: str) -> bool:
    if not isinstance(scope, dict):
        return False
    return any(scope.get(key) is not None for key in keys)


def _scope_string_list(scope: dict[str, Any] | None, key: str) -> list[str]:
    if not isinstance(scope, dict):
        return []
    value = scope.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


AGENT_SKILL_DEFINITIONS = _AGENT_SKILL_DEFINITIONS
skill_by_name = _skill_by_name
agent_plan_payload = _agent_plan_payload
