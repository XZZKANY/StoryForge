from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

TITLE_JOB_NAME = "conversation.title.generate"
SUMMARY_JOB_NAME = "conversation.summary.update"
COMPACTION_JOB_NAME = "conversation.compact"

SYSTEM_SUMMARY_ARTIFACT_KIND = "system_summary"
SYSTEM_COMPACTION_ARTIFACT_KIND = "system_compaction"
HIDDEN_SYSTEM_ARTIFACT_KINDS = frozenset(
    {SYSTEM_SUMMARY_ARTIFACT_KIND, SYSTEM_COMPACTION_ARTIFACT_KIND}
)

COMPACTION_MESSAGE_THRESHOLD = 12
COMPACTION_CHAR_THRESHOLD = 8000
COMPACTION_RETAINED_MESSAGE_COUNT = 4


@dataclass(frozen=True)
class SystemJobPlan:
    """A hidden system job projection plus optional persisted artifact."""

    key: str
    event_payload: dict[str, Any]
    result_payload: dict[str, Any]
    artifact_kind: str | None = None
    artifact_payload: dict[str, Any] | None = None


def build_conversation_system_jobs(
    *,
    assistant_session_id: int,
    current_title: str,
    messages: Sequence[object],
    result: dict[str, Any],
) -> list[SystemJobPlan]:
    """Build hidden title/summary/compaction jobs for an AgentRun response.

    These jobs intentionally stay deterministic for v1. They mimic the OpenCode
    hidden-agent shape without making extra model calls or adding visible roles.
    """

    records = _message_records(messages)
    title_job = _title_job(
        assistant_session_id=assistant_session_id,
        current_title=current_title,
        records=records,
        result=result,
    )
    jobs = [
        title_job,
        _summary_job(assistant_session_id=assistant_session_id, records=records, result=result),
    ]
    compaction_job = _compaction_job(
        assistant_session_id=assistant_session_id,
        records=records,
        result=result,
    )
    if compaction_job is not None:
        jobs.append(compaction_job)
    return jobs


def _title_job(
    *,
    assistant_session_id: int,
    current_title: str,
    records: list[dict[str, str]],
    result: dict[str, Any],
) -> SystemJobPlan:
    source_text = _first_user_message(records) or _string(result.get("user_message")) or current_title
    title = _derive_title(source_text)
    update_session_title = _should_update_title(current_title)
    output = {
        "job_name": TITLE_JOB_NAME,
        "actor": "system-title-agent",
        "hidden": True,
        "mode": "deterministic",
        "status": "completed",
        "assistant_session_id": assistant_session_id,
        "title": title,
        "updated_session_title": update_session_title,
    }
    return SystemJobPlan(
        key="title",
        event_payload={
            **output,
            "message": "隐藏标题任务已生成会话标题。",
            "source": "first_user_message" if _first_user_message(records) else "agent_result",
        },
        result_payload=output,
    )


def _summary_job(
    *,
    assistant_session_id: int,
    records: list[dict[str, str]],
    result: dict[str, Any],
) -> SystemJobPlan:
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    tool_trace = result.get("tool_trace") if isinstance(result.get("tool_trace"), list) else []
    review_report = agent_result.get("review_report") if isinstance(agent_result.get("review_report"), dict) else {}
    review_issues = review_report.get("issues") if isinstance(review_report.get("issues"), list) else []
    summary = _string(agent_result.get("summary")) or "AgentRun 已完成。"
    payload = {
        "kind": SYSTEM_SUMMARY_ARTIFACT_KIND,
        "job_name": SUMMARY_JOB_NAME,
        "hidden": True,
        "mode": "deterministic",
        "assistant_session_id": assistant_session_id,
        "intent": result.get("intent"),
        "message_count": len(records),
        "last_user_message": _last_role_message(records, "user"),
        "assistant_summary": _compact(summary, 600),
        "tool_count": len(tool_trace),
        "review_issue_count": len(review_issues),
        "requires_user_confirmation": bool(
            agent_result.get("requires_user_confirmation") or agent_result.get("confirmation_required")
        ),
    }
    output = {
        "job_name": SUMMARY_JOB_NAME,
        "actor": "system-summary-agent",
        "hidden": True,
        "mode": "deterministic",
        "status": "completed",
        "assistant_session_id": assistant_session_id,
        "summary": payload["assistant_summary"],
        "message_count": payload["message_count"],
        "tool_count": payload["tool_count"],
        "review_issue_count": payload["review_issue_count"],
    }
    return SystemJobPlan(
        key="summary",
        event_payload={**output, "message": "隐藏摘要任务已更新会话摘要。"},
        result_payload=output,
        artifact_kind=SYSTEM_SUMMARY_ARTIFACT_KIND,
        artifact_payload=payload,
    )


def _compaction_job(
    *,
    assistant_session_id: int,
    records: list[dict[str, str]],
    result: dict[str, Any],
) -> SystemJobPlan | None:
    total_chars = sum(len(record["content"]) for record in records)
    if len(records) <= COMPACTION_MESSAGE_THRESHOLD and total_chars <= COMPACTION_CHAR_THRESHOLD:
        return None

    retained = records[-COMPACTION_RETAINED_MESSAGE_COUNT:]
    compacted = records[: max(0, len(records) - len(retained))]
    summary = _compaction_summary(compacted, result)
    payload = {
        "kind": SYSTEM_COMPACTION_ARTIFACT_KIND,
        "job_name": COMPACTION_JOB_NAME,
        "hidden": True,
        "mode": "deterministic",
        "assistant_session_id": assistant_session_id,
        "message_count": len(records),
        "total_chars": total_chars,
        "compacted_message_count": len(compacted),
        "retained_message_count": len(retained),
        "summary": summary,
        "retained_messages": [
            {"role": record["role"], "content": _compact(record["content"], 800)} for record in retained
        ],
    }
    output = {
        "job_name": COMPACTION_JOB_NAME,
        "actor": "system-compaction-agent",
        "hidden": True,
        "mode": "deterministic",
        "status": "completed",
        "assistant_session_id": assistant_session_id,
        "message_count": len(records),
        "total_chars": total_chars,
        "compacted_message_count": len(compacted),
        "retained_message_count": len(retained),
        "summary": summary,
    }
    return SystemJobPlan(
        key="compaction",
        event_payload={**output, "message": "隐藏压缩任务已生成长上下文摘要。"},
        result_payload=output,
        artifact_kind=SYSTEM_COMPACTION_ARTIFACT_KIND,
        artifact_payload=payload,
    )


def _message_records(messages: Sequence[object]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for message in messages:
        role = getattr(message, "role", None)
        content = getattr(message, "content", None)
        if isinstance(role, str) and isinstance(content, str):
            records.append({"role": role, "content": content})
    return records


def _derive_title(text: str) -> str:
    compact = re.sub(r"@\S+", "", text)
    compact = re.sub(r"\s+", "", compact)
    compact = re.sub(r"[，。！？!?；;：:,.、`*_#\[\]（）()<>《》\"'“”‘’]", "", compact).strip()
    for prefix in (
        "请帮我",
        "帮我",
        "请你",
        "请",
        "我想",
        "我要",
        "把这个",
        "把当前",
        "这个",
    ):
        if compact.startswith(prefix):
            compact = compact[len(prefix) :]
            break
    compact = compact.replace("当前章节的结构人物和节奏", "当前章节审稿")
    compact = compact.replace("当前章节的结构与节奏", "当前章节审稿")
    return compact[:18] or "新的创作会话"


def _should_update_title(title: str) -> bool:
    stripped = title.strip()
    if not stripped:
        return True
    return stripped == "新的创作会话" or stripped.startswith("IDE Agent:")


def _first_user_message(records: list[dict[str, str]]) -> str | None:
    for record in records:
        if record["role"] == "user" and record["content"].strip():
            return record["content"]
    return None


def _last_role_message(records: list[dict[str, str]], role: str) -> str | None:
    for record in reversed(records):
        if record["role"] == role and record["content"].strip():
            return _compact(record["content"], 600)
    return None


def _compaction_summary(compacted: list[dict[str, str]], result: dict[str, Any]) -> str:
    first_user = _first_user_message(compacted) or _string(result.get("user_message")) or "未记录首个目标"
    agent_result = result.get("agent_result") if isinstance(result.get("agent_result"), dict) else {}
    latest = _string(agent_result.get("summary")) or "最近一轮已完成"
    return (
        f"已压缩 {len(compacted)} 条较早消息。"
        f"最初目标：{_compact(first_user, 180)}。"
        f"最近结果：{_compact(latest, 260)}"
    )


def _compact(value: str, limit: int) -> str:
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def _string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
