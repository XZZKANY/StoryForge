from __future__ import annotations

from typing import Any

from app.domains.agent_runs._text import _optional_string, _ordered_unique, _string_arg_list
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.role_catalog import get_agent_role, resolve_agent_role_alias

SUPPORTED_INTENTS = frozenset(
    {
        "chat.explain",
        "file.review",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    }
)


def _detect_intent(user_message: str, args: dict[str, Any], explicit_intent: object) -> str:
    if _is_confirm_writeback_request(user_message):
        return "chat.explain"
    if isinstance(explicit_intent, str) and explicit_intent in SUPPORTED_INTENTS:
        return explicit_intent
    text = user_message.lower()
    has_file_context = _optional_string(args.get("file_path")) is not None and isinstance(args.get("content"), str)
    if _has_positive_int(args, "book_id") and _has_positive_int(args, "blueprint_id"):
        return "bookrun.start"
    if _has_positive_int(args, "issue_id"):
        return "chapter.repair"
    if has_file_context and _has_reviewer_role_hint(args):
        return "file.review"
    if has_file_context and _is_file_review_request(user_message):
        return "file.review"
    if has_file_context and _is_file_revise_request(user_message):
        return "file.revise"
    if _has_positive_int(args, "scene_packet_id") or "章节审阅" in user_message or ("审阅" in user_message and not has_file_context):
        return "chapter.review"
    if _is_file_revise_request(user_message):
        return "file.revise"
    if "bookrun" in text or "启动整书" in user_message:
        return "bookrun.start"
    return "chat.explain"


def _is_file_review_request(user_message: str) -> bool:
    return any(keyword in user_message for keyword in ("审查", "审一下", "审稿", "审阅", "评审", "检查", "问题", "一致性", "节奏", "结构"))


def _is_file_revise_request(user_message: str) -> bool:
    text = user_message.lower()
    if any(keyword in text for keyword in ("revise", "rewrite", "diff")):
        return True
    return any(
        keyword in user_message
        for keyword in ("写回", "应用", "保存", "直接改", "直接修", "改写", "修订", "润色", "修改", "改得", "改成", "改一版", "修一版", "紧一点")
    )


def _is_confirm_writeback_request(user_message: str) -> bool:
    text = user_message.strip().lower()
    if any(keyword in text for keyword in ("accept this", "apply this", "confirm writeback")):
        return True
    if any(keyword in user_message for keyword in ("确认写回", "接受这版", "就这版写回", "应用这版", "确认应用")):
        return True
    if any(keyword in user_message for keyword in ("确认", "接受")) and any(keyword in user_message for keyword in ("当前补丁", "当前修订")):
        return True
    return ("写回" in user_message or "应用" in user_message) and any(keyword in user_message for keyword in ("确认", "接受", "这版", "当前补丁", "当前修订"))


def _message_text(message: dict[str, Any]) -> str:
    for key in ("user_message", "message", "content"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise AgentOrchestrationError("Agent user_message 不能为空。")


def _message_args(message: dict[str, Any]) -> dict[str, Any]:
    args = message.get("args")
    return dict(args) if isinstance(args, dict) else {}


def _role_hints(args: dict[str, Any]) -> list[str]:
    hints = _string_arg_list(args.get("agent_role_hints"))
    mentions = _string_arg_list(args.get("agent_role_mentions"))
    candidates = list(hints)
    for mention in mentions:
        role = _resolve_role_mention(mention)
        if role is not None and role.can_be_mentioned:
            candidates.append(role.name)

    resolved: list[str] = []
    for hint in candidates:
        role = get_agent_role(hint) or resolve_agent_role_alias(hint)
        if role is not None and role.can_be_mentioned:
            resolved.append(role.name)
    return _ordered_unique(resolved)


def _role_mentions(args: dict[str, Any]) -> list[str]:
    return _ordered_unique(_string_arg_list(args.get("agent_role_mentions")))


def _resolve_role_mention(mention: str):
    role = get_agent_role(mention) or resolve_agent_role_alias(mention)
    if role is not None:
        return role
    return None


def _has_reviewer_role_hint(args: dict[str, Any]) -> bool:
    return bool({"plot_reviewer", "character_reviewer", "prose_reviewer", "continuity_reviewer"} & set(_role_hints(args)))


def _has_positive_int(args: dict[str, Any], key: str) -> bool:
    value = args.get(key)
    return isinstance(value, int) and value > 0
