from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.assistant import service as assistant_service
from app.domains.assistant.schemas import (
    AssistantMessageCreate,
    AssistantReviseRequest,
    AssistantSessionCreate,
    AssistantToolCallCreate,
    AssistantToolCallUpdate,
)
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.ide.service import (
    IdeCommandExecutionError,
    IdeCommandNotFoundError,
    execute_ide_command_by_id,
)

SUPPORTED_INTENTS = frozenset(
    {
        "chat.explain",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    }
)


class AgentOrchestrationError(RuntimeError):
    """Agent 编排输入不足或下游工具执行失败。"""


@dataclass(frozen=True)
class AgentToolTrace:
    """WebSocket 响应中的轻量工具调用轨迹。"""

    tool_name: str
    status: str
    input_summary: dict[str, Any]
    output_summary: dict[str, Any] | None = None
    audit_event_id: str | None = None
    assistant_tool_call_id: int | None = None
    error_message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tool_name": self.tool_name,
            "status": self.status,
            "input_summary": self.input_summary,
        }
        if self.output_summary is not None:
            payload["output_summary"] = self.output_summary
        if self.audit_event_id is not None:
            payload["audit_event_id"] = self.audit_event_id
        if self.assistant_tool_call_id is not None:
            payload["assistant_tool_call_id"] = self.assistant_tool_call_id
        if self.error_message is not None:
            payload["error_message"] = self.error_message
        return payload


def orchestrate_agent_message(
    session: Session,
    *,
    agent_session_id: str,
    message: dict[str, Any],
) -> dict[str, Any]:
    """在现有 IDE Agent WebSocket 通道上执行一轮最小 Orchestrator。

    Orchestrator 只负责识别意图、生成计划和调度现有工具。真实写命令仍走
    IDE command registry；文件修订只返回 proposed_patch，由 Desktop IDE 决定
    是否写回本地文件。
    """

    user_message = _message_text(message)
    args = _message_args(message)
    intent = _detect_intent(user_message, args, message.get("intent"))
    assistant_session = assistant_service.create_assistant_session(
        session,
        AssistantSessionCreate(
            title=f"IDE Agent: {user_message[:120]}",
            task_type="ide_agent_orchestration",
            messages=[],
        ),
    )
    if intent != "file.revise":
        assistant_service.append_assistant_message(
            session,
            assistant_session.id,
            AssistantMessageCreate(role="user", content=user_message),
        )

    if intent == "chat.explain":
        return _orchestrate_chat_explain(
            session,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session.id,
            user_message=user_message,
            args=args,
        )
    if intent == "file.revise":
        return _orchestrate_file_revise(
            session,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session.id,
            user_message=user_message,
            args=args,
        )
    if intent == "chapter.review":
        return _orchestrate_chapter_review(
            session,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session.id,
            user_message=user_message,
            args=args,
        )
    if intent == "chapter.repair":
        return _orchestrate_chapter_repair(
            session,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session.id,
            user_message=user_message,
            args=args,
        )
    if intent == "bookrun.start":
        return _orchestrate_bookrun_start(
            session,
            agent_session_id=agent_session_id,
            assistant_session_id=assistant_session.id,
            user_message=user_message,
            args=args,
        )
    raise AgentOrchestrationError(f"暂不支持的 Agent intent：{intent}")


def _base_response(
    *,
    agent_session_id: str,
    assistant_session_id: int,
    intent: str,
    user_message: str,
    plan: list[dict[str, Any]],
    agent_result: dict[str, Any],
    tool_trace: list[AgentToolTrace],
    proposed_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "type": "agent_result",
        "session_id": agent_session_id,
        "assistant_session_id": assistant_session_id,
        "intent": intent,
        "user_message": user_message,
        "plan": plan,
        "agent_result": agent_result,
        "tool_trace": [item.as_dict() for item in tool_trace],
        "proposed_patch": proposed_patch,
    }


def _orchestrate_chat_explain(
    session: Session,
    *,
    agent_session_id: str,
    assistant_session_id: int,
    user_message: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    context = _compact_text(args.get("context") or args.get("selection") or args.get("content"), limit=900)
    answer = (
        "我可以解释当前上下文、评审结果或命令执行计划。"
        if not context
        else f"这段上下文的核心是：{context}"
    )
    assistant_service.append_assistant_message(
        session,
        assistant_session_id,
        AssistantMessageCreate(role="assistant", content=answer),
    )
    return _base_response(
        agent_session_id=agent_session_id,
        assistant_session_id=assistant_session_id,
        intent="chat.explain",
        user_message=user_message,
        plan=[_plan_step("respond", "解释用户问题，不执行写命令。", "completed")],
        agent_result={"summary": answer, "requires_user_confirmation": False},
        tool_trace=[],
    )


def _orchestrate_file_revise(
    session: Session,
    *,
    agent_session_id: str,
    assistant_session_id: int,
    user_message: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    file_path = _required_string(args, "file_path")
    content = _required_string(args, "content")
    instruction = _optional_string(args.get("instruction")) or user_message
    tool_trace: list[AgentToolTrace] = []
    try:
        response = assistant_service.revise_file_content(
            session,
            AssistantReviseRequest(
                file_path=file_path,
                content=content,
                instruction=instruction,
                project_name=_optional_string(args.get("project_name")),
                assistant_session_id=assistant_session_id,
                context_bundle=args.get("context_bundle") if isinstance(args.get("context_bundle"), dict) else None,
            ),
        )
    except (
        assistant_service.AssistantLlmNotConfiguredError,
        assistant_service.AssistantReviseError,
        assistant_service.AssistantSessionNotFoundError,
    ) as exc:
        raise AgentOrchestrationError(str(exc)) from exc

    tool_trace.append(
        AgentToolTrace(
            tool_name="assistant.revise",
            status="completed",
            input_summary={"file_path": file_path, "content_chars": len(content)},
            output_summary={
                "after_chars": len(response.after),
                "model": response.model,
                "latency_ms": response.latency_ms,
                "completion_tokens": response.completion_tokens,
            },
        )
    )
    return _base_response(
        agent_session_id=agent_session_id,
        assistant_session_id=assistant_session_id,
        intent="file.revise",
        user_message=user_message,
        plan=[
            _plan_step("intent", "识别为本地文件修订。", "completed"),
            _plan_step("revise", "调用 /api/assistant/revise 生成修订后正文。", "completed"),
            _plan_step("approval", "等待 Desktop IDE 用户确认后再写回文件。", "needs_approval"),
        ],
        agent_result={
            "summary": response.summary,
            "requires_user_confirmation": True,
            "writeback_blocked_until_user_confirms": True,
        },
        tool_trace=tool_trace,
        proposed_patch={
            "kind": "file_revision",
            "file_path": file_path,
            "before": response.before,
            "after": response.after,
            "requires_confirmation": True,
            "approval_action": "desktop.confirm_file_writeback",
        },
    )


def _orchestrate_chapter_review(
    session: Session,
    *,
    agent_session_id: str,
    assistant_session_id: int,
    user_message: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    scene_packet_id = _required_int(args, "scene_packet_id")
    review_args = _judge_run_args_from_scene_packet(session, scene_packet_id)
    tool_trace: list[AgentToolTrace] = []
    judge_result = _execute_command_with_tool_audit(
        session,
        assistant_session_id=assistant_session_id,
        command_id="judge.run",
        args=review_args,
        tool_trace=tool_trace,
        related_type="scene_packet",
        related_id=scene_packet_id,
    )
    issues = _payload_list(judge_result.payload.get("issues"))
    repair_results = []
    for issue in issues:
        issue_id = issue.get("id")
        if isinstance(issue_id, int) and _can_repair_issue(issue, review_args["content"]):
            repair_results.append(
                _execute_command_with_tool_audit(
                    session,
                    assistant_session_id=assistant_session_id,
                    command_id="judge.repair",
                    args={"issue_id": issue_id, "content": review_args["content"]},
                    tool_trace=tool_trace,
                    related_type="judge_issue",
                    related_id=issue_id,
                )
            )

    patch_payload = _first_patch_payload(repair_results)
    proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
    summary = f"章节审阅完成：发现 {len(issues)} 个问题，生成 {len(repair_results)} 个修复建议。"
    assistant_service.append_assistant_message(
        session,
        assistant_session_id,
        AssistantMessageCreate(role="assistant", content=summary),
    )
    return _base_response(
        agent_session_id=agent_session_id,
        assistant_session_id=assistant_session_id,
        intent="chapter.review",
        user_message=user_message,
        plan=[
            _plan_step("load_scene_packet", "读取 Scene Packet 与场景正文。", "completed"),
            _plan_step("judge.run", "通过 IDE command registry 执行章节评审。", "completed"),
            _plan_step("judge.repair", "为可修复问题生成 proposed patch。", "completed"),
            _plan_step("approval", "修复写回必须等待用户确认 judge.approve。", "needs_approval" if proposed_patch else "completed"),
        ],
        agent_result={
            "summary": summary,
            "issue_count": len(issues),
            "repair_patch_count": len(repair_results),
            "requires_user_confirmation": proposed_patch is not None,
        },
        tool_trace=tool_trace,
        proposed_patch=proposed_patch,
    )


def _orchestrate_chapter_repair(
    session: Session,
    *,
    agent_session_id: str,
    assistant_session_id: int,
    user_message: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    repair_args = {"issue_id": _required_int(args, "issue_id"), "content": _required_string(args, "content")}
    tool_trace: list[AgentToolTrace] = []
    result = _execute_command_with_tool_audit(
        session,
        assistant_session_id=assistant_session_id,
        command_id="judge.repair",
        args=repair_args,
        tool_trace=tool_trace,
        related_type="judge_issue",
        related_id=repair_args["issue_id"],
    )
    patch_payload = result.payload.get("patch") if isinstance(result.payload.get("patch"), dict) else None
    proposed_patch = _proposed_patch_from_repair_patch(patch_payload) if patch_payload else None
    summary = "已生成章节修复建议，等待用户确认后才能执行 judge.approve 写回。"
    assistant_service.append_assistant_message(
        session,
        assistant_session_id,
        AssistantMessageCreate(role="assistant", content=summary),
    )
    return _base_response(
        agent_session_id=agent_session_id,
        assistant_session_id=assistant_session_id,
        intent="chapter.repair",
        user_message=user_message,
        plan=[
            _plan_step("judge.repair", "通过 IDE command registry 生成定向修复。", "completed"),
            _plan_step("approval", "等待用户确认后再执行 judge.approve 写回。", "needs_approval"),
        ],
        agent_result={"summary": summary, "requires_user_confirmation": proposed_patch is not None},
        tool_trace=tool_trace,
        proposed_patch=proposed_patch,
    )


def _orchestrate_bookrun_start(
    session: Session,
    *,
    agent_session_id: str,
    assistant_session_id: int,
    user_message: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    command_args = {
        "book_id": _required_int(args, "book_id"),
        "blueprint_id": _required_int(args, "blueprint_id"),
    }
    for key in ("token_budget", "time_budget_sec", "chapter_budget"):
        value = args.get(key)
        if isinstance(value, int) and value > 0:
            command_args[key] = value

    tool_trace: list[AgentToolTrace] = []
    result = _execute_command_with_tool_audit(
        session,
        assistant_session_id=assistant_session_id,
        command_id="bookrun.start",
        args=command_args,
        tool_trace=tool_trace,
        related_type="book",
        related_id=command_args["book_id"],
    )
    book_run = result.payload.get("book_run") if isinstance(result.payload.get("book_run"), dict) else {}
    summary = f"BookRun 已启动：book_run_id={book_run.get('id')}，状态 {book_run.get('status')}。"
    assistant_service.append_assistant_message(
        session,
        assistant_session_id,
        AssistantMessageCreate(role="assistant", content=summary),
    )
    return _base_response(
        agent_session_id=agent_session_id,
        assistant_session_id=assistant_session_id,
        intent="bookrun.start",
        user_message=user_message,
        plan=[
            _plan_step("bookrun.start", "通过 IDE command registry 启动 BookRun。", "completed"),
            _plan_step("audit", "返回 command audit_event_id 供 IDE 追溯。", "completed"),
        ],
        agent_result={"summary": summary, "book_run": book_run, "requires_user_confirmation": False},
        tool_trace=tool_trace,
    )


def _execute_command_with_tool_audit(
    session: Session,
    *,
    assistant_session_id: int,
    command_id: str,
    args: dict[str, Any],
    tool_trace: list[AgentToolTrace],
    related_type: str | None = None,
    related_id: int | None = None,
):
    tool_call = assistant_service.create_assistant_tool_call(
        session,
        assistant_session_id,
        AssistantToolCallCreate(
            tool_name=command_id,
            status="running",
            input_summary=_safe_summary(args),
            related_type=related_type,
            related_id=related_id,
        ),
    )
    try:
        result = execute_ide_command_by_id(command_id, args, session)
    except (IdeCommandNotFoundError, IdeCommandExecutionError) as exc:
        assistant_service.update_assistant_tool_call(
            session,
            tool_call.id,
            AssistantToolCallUpdate(status="failed", error_message=str(exc)[:4000]),
        )
        tool_trace.append(
            AgentToolTrace(
                tool_name=command_id,
                status="failed",
                input_summary=_safe_summary(args),
                assistant_tool_call_id=tool_call.id,
                error_message=str(exc),
            )
        )
        raise AgentOrchestrationError(str(exc)) from exc

    output_summary = _safe_summary(result.payload)
    assistant_service.update_assistant_tool_call(
        session,
        tool_call.id,
        AssistantToolCallUpdate(
            status="completed",
            output_summary={**output_summary, "audit_event_id": result.audit_event_id},
        ),
    )
    tool_trace.append(
        AgentToolTrace(
            tool_name=command_id,
            status="completed",
            input_summary=_safe_summary(args),
            output_summary=output_summary,
            audit_event_id=result.audit_event_id,
            assistant_tool_call_id=tool_call.id,
        )
    )
    return result


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


def _detect_intent(user_message: str, args: dict[str, Any], explicit_intent: object) -> str:
    if isinstance(explicit_intent, str) and explicit_intent in SUPPORTED_INTENTS:
        return explicit_intent
    text = user_message.lower()
    if _has_positive_int(args, "book_id") and _has_positive_int(args, "blueprint_id"):
        return "bookrun.start"
    if _has_positive_int(args, "issue_id"):
        return "chapter.repair"
    if _has_positive_int(args, "scene_packet_id") or "章节审阅" in user_message or "审阅" in user_message:
        return "chapter.review"
    if _optional_string(args.get("file_path")) and isinstance(args.get("content"), str):
        return "file.revise"
    if any(keyword in text for keyword in ("revise", "rewrite")) or any(
        keyword in user_message for keyword in ("修订", "改写", "润色")
    ):
        return "file.revise"
    if "bookrun" in text or "启动整书" in user_message:
        return "bookrun.start"
    return "chat.explain"


def _message_text(message: dict[str, Any]) -> str:
    for key in ("user_message", "message", "content"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise AgentOrchestrationError("Agent user_message 不能为空。")


def _message_args(message: dict[str, Any]) -> dict[str, Any]:
    args = message.get("args")
    return dict(args) if isinstance(args, dict) else {}


def _plan_step(step: str, detail: str, status: str) -> dict[str, str]:
    return {"step": step, "detail": detail, "status": status}


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


def _optional_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _has_positive_int(args: dict[str, Any], key: str) -> bool:
    value = args.get(key)
    return isinstance(value, int) and value > 0


def _compact_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def _safe_summary(payload: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key, value in payload.items():
        if key == "content" and isinstance(value, str):
            summary["content_chars"] = len(value)
        elif isinstance(value, str):
            summary[key] = _compact_text(value, limit=240)
        elif isinstance(value, int | float | bool) or value is None:
            summary[key] = value
        elif isinstance(value, list):
            summary[key] = {"count": len(value)}
        elif isinstance(value, dict):
            summary[key] = {"keys": sorted(str(item) for item in value)[:20]}
    return summary


def _payload_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _dict_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


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


def _can_repair_issue(issue: dict[str, Any], content: object) -> bool:
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
    for result in results:
        patch = result.payload.get("patch")
        if isinstance(patch, dict):
            return patch
    return None


def _proposed_patch_from_repair_patch(patch: dict[str, Any] | None) -> dict[str, Any] | None:
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
