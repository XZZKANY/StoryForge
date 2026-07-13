from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import REDACTED, is_sensitive_key, redact_sensitive_text
from app.domains.agent_runs._text import compact_text as _compact_text
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket


def _fs_int_arg(payload: dict[str, Any], key: str, default: int) -> int:
    """LLM 工具参数容错：int 直接用，数字字符串转换，其余回退默认值。"""

    value = payload.get(key)
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value)
    return default


def _chat_context_block(args: dict[str, Any]) -> str:
    """从前端项目上下文 bundle 拼一段供对话用的摘录；无 bundle 时返回空串。"""
    bundle = args.get("context_bundle")
    if not isinstance(bundle, dict):
        return ""
    files = bundle.get("files")
    if not isinstance(files, list):
        return ""
    entries: list[str] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        excerpt = _compact_text(item.get("excerpt"), limit=1500)
        if not excerpt:
            continue
        rel = _optional_string(item.get("relative_path")) or _optional_string(item.get("path")) or "（未命名）"
        kind = _optional_string(item.get("kind"))
        header = f"### {rel}" + (f"（{kind}）" if kind else "")
        entries.append(f"{header}\n<<<\n{excerpt}\n>>>")
    return "\n\n".join(entries)


def _required_string(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if isinstance(value, str) and value.strip():
        return value
    raise AgentOrchestrationError(f"Agent intent 缺少参数：{key}。")


def _required_int(args: dict[str, Any], key: str) -> int:
    value = args.get(key)
    if isinstance(value, int) and value > 0:
        return value
    raise AgentOrchestrationError(f"Agent intent 缺少参数：{key}。")


def _optional_positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _trim_prose_instruction(target_percent: int) -> str:
    """构建 15% 压缩修订指令模板。"""
    return (
        f"将本章字数压缩 {target_percent}%，要求：\n"
        "- 保留所有剧情信息、情感高潮、人物动作\n"
        "- 砍掉冗余的副词（「他愤怒地说」→「他说」或直接用动作语气带）\n"
        "- 砍掉情绪声明句（「她感到恐惧」→ 用生理反应/环境暗示替代）\n"
        "- 每段不超过 5 句（长段落拆开，除非是刻意营造的紧迫感）\n"
        "- 不要删除对话和关键描写\n"
        f"- 在回复末尾给出字数审计报告：原字数 → 压缩后字数 → 压缩率（目标 {target_percent}%）"
    )


def _safe_summary(payload: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key, value in payload.items():
        if is_sensitive_key(key):
            summary[key] = REDACTED
        elif key == "content" and isinstance(value, str):
            summary["content_chars"] = len(value)
        elif isinstance(value, str):
            summary[key] = redact_sensitive_text(_compact_text(value, limit=240))
        elif isinstance(value, int | float | bool) or value is None:
            summary[key] = value
        elif isinstance(value, list):
            summary[key] = {"count": len(value)}
        elif isinstance(value, dict):
            summary[key] = {"keys": sorted(str(item) for item in value)[:20]}
    return summary


def _llm_context_input_summary(snapshot: object) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}
    snapshot_id = snapshot.get("snapshot_id")
    if not isinstance(snapshot_id, str) or not snapshot_id:
        return {}
    return {"llm_context_snapshot_id": snapshot_id}


def _judge_run_args_from_scene_packet(session: Session, scene_packet_id: int) -> dict[str, Any]:
    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(ScenePacket.id == scene_packet_id)
        .limit(1)
    ).first()
    if row is None:
        raise AgentOrchestrationError("Scene Packet 不存在，无法执行章节审阅。")
    scene_packet, scene, _chapter = row
    content = (scene.content or "").strip()
    if not content:
        raise AgentOrchestrationError("场景正文为空，无法执行章节审阅。")
    packet = scene_packet.packet or {}
    return {
        "scene_id": scene.id,
        "scene_packet_id": scene_packet.id,
        "content": content,
        "required_facts": _string_list(packet.get("必须包含事实")),
        "style_rules": _style_rules(packet.get("风格规则")),
        "evidence_links": _dict_list(packet.get("证据链接")),
    }


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _dict_list(value: object) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _style_rules(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    rules: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            rules.append(item.strip())
        elif isinstance(item, dict):
            rule = item.get("rule")
            if isinstance(rule, str) and rule.strip():
                rules.append(rule.strip())
    return rules


def _payload_list(value: object) -> list[dict[str, Any]]:
    """Extract dict items from a list, filtering non-dict entries."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _can_repair_issue(issue: dict[str, Any], content: object) -> bool:
    """Check if a judge issue is eligible for auto-repair."""
    if not isinstance(content, str):
        return False
    if issue.get("status") != "open":
        return False
    if issue.get("recommended_repair_mode") == "none":
        return False
    start = issue.get("span_start")
    end = issue.get("span_end")
    return isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(content)


def _first_patch_payload(results: list[Any]) -> dict[str, Any] | None:
    """Extract first patch from ToolResult list via output[result][payload][patch]."""
    for result in results:
        result_block = result.output.get("result", {}) if hasattr(result, "output") else {}
        payload = result_block.get("payload") if isinstance(result_block.get("payload"), dict) else {}
        patch = payload.get("patch")
        if isinstance(patch, dict):
            return patch
    return None


def _proposed_patch_from_repair_patch(patch: dict[str, Any] | None) -> dict[str, Any] | None:
    """Convert a raw repair patch into the proposed_patch contract."""
    if not patch:
        return None
    patch_id = patch.get("id")
    proposed: dict[str, Any] = {
        "kind": "repair_patch",
        "repair_patch": patch,
        "requires_confirmation": True,
        "approval_command": None,
    }
    if isinstance(patch_id, int):
        proposed["approval_command"] = {"command_id": "judge.approve", "args": {"repair_patch_id": patch_id}}
    return proposed


fs_int_arg = _fs_int_arg
chat_context_block = _chat_context_block
required_string = _required_string
required_int = _required_int
optional_positive_int = _optional_positive_int
optional_int = _optional_int
trim_prose_instruction = _trim_prose_instruction
safe_summary = _safe_summary
llm_context_input_summary = _llm_context_input_summary
judge_run_args_from_scene_packet = _judge_run_args_from_scene_packet
string_list = _string_list
dict_list = _dict_list
style_rules = _style_rules
payload_list = _payload_list
can_repair_issue = _can_repair_issue
first_patch_payload = _first_patch_payload
proposed_patch_from_repair_patch = _proposed_patch_from_repair_patch
