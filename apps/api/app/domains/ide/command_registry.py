from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.common.llm_env import missing_llm_env, resolved_llm_env
from app.common.redaction import redact_sensitive
from app.domains.agent_runs import book_context, serial_plan_update
from app.domains.agent_runs.canon_service import run_canon_projection
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.observatory import run_observatory_scan
from app.domains.ide.book_breakdown import (
    BookBreakdownError,
    prepare_breakdown_cancellation,
    read_book_breakdown_status,
    run_book_breakdown,
)
from app.domains.ide.book_breakdown_control import request_breakdown_cancel
from app.domains.ide.schemas import IdeCommandResult


@dataclass(frozen=True)
class IdeCommandDefinition:
    """IDE 命令目录中的最小命令元数据。"""

    id: str
    title: str
    category: str
    writes: bool = True


_BUILTIN_COMMANDS: dict[str, IdeCommandDefinition] = {
    command.id: command
    for command in [
        IdeCommandDefinition(id="audit.open", title="打开审计记录", category="Audit", writes=False),
        # canon.refresh 只写派生缓存（.storyforge/canon/derived/），不落 DB，故 writes=False 免审计工作区副作用。
        IdeCommandDefinition(id="canon.refresh", title="刷新 Canon 事实卡（dossier）", category="Canon", writes=False),
        # observatory.scan 同为确定性派生缓存写入（observations.json），无 LLM 无 DB。
        IdeCommandDefinition(id="observatory.scan", title="重扫世界线观测镜", category="Canon", writes=False),
        IdeCommandDefinition(id="book.breakdown", title="生成结构化拆书报告", category="Analysis", writes=False),
        IdeCommandDefinition(id="book.breakdown.cancel", title="取消结构化拆书", category="Analysis", writes=False),
        IdeCommandDefinition(id="book.breakdown.status", title="检查拆书报告状态", category="Analysis", writes=False),
        # book.context 是纯只读投影：连派生缓存都不写，只 stat + 读 canon.json / presence 缓存。
        IdeCommandDefinition(id="book.context", title="读取作品底座", category="Manuscript", writes=False),
        # plan.mark_written / plan.unmark_written 只写 .storyforge/serial-plan.json（非手稿、非 DB），故 writes=False。
        IdeCommandDefinition(
            id="plan.mark_written", title="标记章节已写入连载计划", category="Manuscript", writes=False
        ),
        IdeCommandDefinition(
            id="plan.unmark_written", title="撤销章节的连载计划标记", category="Manuscript", writes=False
        ),
    ]
}


class IdeCommandNotFoundError(NotFoundError, Exception):
    """命令目录中不存在指定命令。"""


class IdeCommandExecutionError(InputError, Exception):
    """命令参数或领域状态不满足执行条件。"""


def execute_ide_command_by_id(
    command_id: str,
    args: dict[str, object] | None = None,
    session: Session | None = None,
) -> IdeCommandResult:
    """执行已注册 IDE 命令并返回审计追踪结果。"""

    command = _BUILTIN_COMMANDS.get(command_id)
    if command is None:
        raise IdeCommandNotFoundError(f"未知 IDE 命令：{command_id}")

    normalized_args = args or {}
    if command.id == "canon.refresh":
        result = _execute_canon_refresh_command(command, normalized_args, None)
    elif command.id == "observatory.scan":
        result = _execute_observatory_scan_command(command, normalized_args, None)
    elif command.id == "book.breakdown":
        result = _execute_book_breakdown_command(command, normalized_args, None, session)
    elif command.id == "book.breakdown.cancel":
        result = _execute_book_breakdown_cancel_command(command, normalized_args, None)
    elif command.id == "book.breakdown.status":
        result = _execute_book_breakdown_status_command(command, normalized_args, None)
    elif command.id == "book.context":
        result = _execute_book_context_command(command, normalized_args, None)
    elif command.id in {"plan.mark_written", "plan.unmark_written"}:
        result = _execute_plan_mark_written_command(command, normalized_args, None)
    else:
        result = _accepted_command_result(command, normalized_args, None)

    return result


def _accepted_command_result(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    extra_payload: dict[str, object] | None = None,
) -> IdeCommandResult:
    """组装 IDE 命令通用响应，并保留原始参数用于审计。"""

    payload: dict[str, object] = {
        "title": command.title,
        "category": command.category,
        "writes": command.writes,
        "args": redact_sensitive(args),
    }
    if extra_payload:
        payload.update(redact_sensitive(extra_payload))
    return IdeCommandResult(
        command_id=command.id,
        status="accepted",
        audit_event_id=audit_event_id,
        payload=redact_sensitive(payload),
    )
def _execute_canon_refresh_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    """确定性触发 canon 投影：重建在场 + 闸门 + dossier，写派生缓存（无 LLM，无 key）。"""

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("canon.refresh 需要 project_root。")
    glob_arg = args.get("glob")
    glob = glob_arg.strip() if isinstance(glob_arg, str) and glob_arg.strip() else "*.md"
    refresh = args.get("refresh") is not False
    try:
        output = run_canon_projection(project_root.strip(), glob=glob, refresh=refresh)
    except FsToolError as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(command, args, audit_event_id, {"canon": output})


def _execute_observatory_scan_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    """确定性重扫观测镜：canon 闸 + 伏笔账 + 文笔气味，归一化观测落派生缓存（无 LLM，无 key）。"""

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("observatory.scan 需要 project_root。")
    glob_arg = args.get("glob")
    glob = glob_arg.strip() if isinstance(glob_arg, str) and glob_arg.strip() else "*.md"
    try:
        output = run_observatory_scan(project_root.strip(), glob=glob)
    except FsToolError as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(command, args, audit_event_id, {"observatory": output})


def _execute_book_breakdown_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    session: Session | None,
) -> IdeCommandResult:
    """生成只读拆书底稿；项目报告与 AgentArtifact 分离保存。"""

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("book.breakdown 需要 project_root。")
    target_count = args.get("target_count", 8)
    if not isinstance(target_count, int) or not 3 <= target_count <= 12:
        raise IdeCommandExecutionError("book.breakdown 的 target_count 必须在 3 到 12 之间。")
    try:
        llm_source = resolved_llm_env()
        model_source = llm_source if not missing_llm_env(llm_source) else None
        analysis_id_arg = args.get("analysis_id")
        analysis_id = analysis_id_arg.strip() if isinstance(analysis_id_arg, str) and analysis_id_arg.strip() else None
        cancel_event = prepare_breakdown_cancellation(analysis_id) if analysis_id else None
        output = run_book_breakdown(
            project_root.strip(),
            target_count=target_count,
            model_source=model_source,
            analysis_id=analysis_id,
            cancel_event=cancel_event,
        )
    except (BookBreakdownError, FsToolError, OSError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc

    if session is not None:
        from app.domains.agent_runs.service_lifecycle import create_or_resume_agent_run
        from app.domains.agent_runs.service_store import complete_agent_run, record_agent_artifact

        run = create_or_resume_agent_run(
            session,
            public_id=f"breakdown-{output['analysis_id']}",
            session_id=f"breakdown:{output['analysis_id']}",
            goal="生成结构化拆书报告",
            scope={"analysis_id": output["analysis_id"], "input_sha256": output["input_sha256"]},
        )
        artifact = record_agent_artifact(
            session,
            run,
            kind="book_breakdown_report",
            payload={
                "analysis_id": output["analysis_id"],
                "input_sha256": output["input_sha256"],
                "schema_version": output["schema_version"],
                "selection_strategy_version": output["selection_strategy_version"],
                "status": output["status"],
                "paths": output["paths"],
                "chapter_count": output["chapter_count"],
                "selected_count": len(output["selected_chapters"]),
                "provider": output.get("provider"),
                "model": output.get("model"),
                "retries": output.get("retries", 0),
                "model_error": output.get("model_error"),
            },
        )
        complete_agent_run(
            session,
            run,
            result={"agent_result": {"summary": "结构化拆书底稿已生成。"}},
        )
        output = {**output, "run_id": run.public_id, "artifact_id": artifact.id}
    return _accepted_command_result(command, args, audit_event_id, {"breakdown": output})


def _execute_book_breakdown_cancel_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    analysis_id = args.get("analysis_id")
    if not isinstance(analysis_id, str) or not analysis_id.strip():
        raise IdeCommandExecutionError("book.breakdown.cancel 需要 analysis_id。")
    requested = request_breakdown_cancel(analysis_id.strip())
    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        {"breakdown": {"analysis_id": analysis_id.strip(), "cancellation_requested": requested}},
    )


def _execute_book_breakdown_status_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("book.breakdown.status 需要 project_root。")
    try:
        output = read_book_breakdown_status(project_root.strip())
    except (BookBreakdownError, FsToolError, OSError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(command, args, audit_event_id, {"breakdown": output})


def _execute_book_context_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    """只读投影作品底座：桌面端左栏据此显示「模型这轮拿到了什么」（无 LLM，无 key，不写盘）。

    与 `canon.refresh` / `observatory.scan` 的区别是它连派生缓存都不写——所以可以随光标
    移动高频调用。失败时显式报错而不是回空对象：静默的空底座会让作者以为「书里什么都没有」。
    """

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("book.context 需要 project_root。")
    current_file_arg = args.get("current_file")
    current_file = (
        current_file_arg.strip()
        if isinstance(current_file_arg, str) and current_file_arg.strip()
        else None
    )
    context = book_context.build_book_context(project_root.strip(), current_file)
    if context is None:
        raise IdeCommandExecutionError(f"读不到项目：{project_root.strip()}")
    return _accepted_command_result(
        command, args, audit_event_id, {"book_context": book_context.to_payload(context)}
    )


def _execute_plan_mark_written_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
) -> IdeCommandResult:
    """在连载计划里把对应章标 done（接受补丁后）或退回 pending（撤销新建后）。

    确定性，无 LLM，不碰手稿。参数缺失才报错；「没改」不是错误——非正文、章不在计划、
    计划不存在、正文还在都是正常结果，如实带 reason 返回。桌面端据此决定要不要提示，
    而不是把一次无害的 no-op 弹成失败。
    """

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError(f"{command.id} 需要 project_root。")
    file_path = args.get("file_path")
    if not isinstance(file_path, str) or not file_path.strip():
        raise IdeCommandExecutionError(f"{command.id} 需要 file_path。")
    run = (
        serial_plan_update.unmark_chapter_written
        if command.id == "plan.unmark_written"
        else serial_plan_update.mark_chapter_written
    )
    outcome = run(project_root.strip(), file_path.strip())
    return _accepted_command_result(command, args, audit_event_id, {"plan": outcome})
