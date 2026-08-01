from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.common.redaction import redact_sensitive
from app.domains.agent_runs import book_context, serial_plan_update
from app.domains.agent_runs.canon_service import run_canon_projection
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.observatory import run_observatory_scan
from app.domains.book_runs.service import (
    BookRunBlockedError,
    BookRunError,
    BookRunNotFoundError,
)
from app.domains.books.models import Book
from app.domains.events.models import EventLog
from app.domains.ide._coerce import _int_or_none
from app.domains.ide.schemas import IdeCommandResult
from app.domains.judge.schemas import JudgeIssueCreate, JudgeIssueRead
from app.domains.judge.service import JudgeInputError, create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate, RepairPatchRead
from app.domains.repair.service import RepairInputError, create_repair_patch
from app.domains.studio.schemas import StudioApprovalExecuteRequest
from app.domains.studio.service import StudioApprovalSummaryNotFoundError, approve_studio_writeback
from app.domains.workspaces.models import Workspace
from app.domains.writing_runs.schemas import WritingRunStart
from app.domains.writing_runs.service import (
    pause_writing_run,
    resume_writing_run,
    retry_writing_run_from_checkpoint,
    start_writing_run,
    stop_writing_run,
    writing_run_payload,
)


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
        IdeCommandDefinition(id="judge.run", title="运行 Judge", category="Judge"),
        IdeCommandDefinition(id="judge.repair", title="生成定向修复", category="Judge"),
        IdeCommandDefinition(id="judge.approve", title="批准修复写回", category="Judge"),
        # bookrun.* 已于 2026-08-01 摘除桌面入口（作者拍板退役批量整书）：定义不再注册，
        # 但 _execute_bookrun_command 与分派分支、book_runs service 全部保留。
        # 回滚 = 把这 5 行 IdeCommandDefinition 加回来（同 W4 冻结域手法）。
        IdeCommandDefinition(id="audit.open", title="打开审计记录", category="Audit", writes=False),
        # canon.refresh 只写派生缓存（.storyforge/canon/derived/），不落 DB，故 writes=False 免审计工作区副作用。
        IdeCommandDefinition(id="canon.refresh", title="刷新 Canon 事实卡（dossier）", category="Canon", writes=False),
        # observatory.scan 同为确定性派生缓存写入（observations.json），无 LLM 无 DB。
        IdeCommandDefinition(id="observatory.scan", title="重扫世界线观测镜", category="Canon", writes=False),
        # book.context 是纯只读投影：连派生缓存都不写，只 stat + 读 canon.json / presence 缓存。
        IdeCommandDefinition(id="book.context", title="读取作品底座", category="Manuscript", writes=False),
        # plan.mark_written 只写 .storyforge/serial-plan.json（非手稿、非 DB），故 writes=False。
        IdeCommandDefinition(
            id="plan.mark_written", title="标记章节已写入连载计划", category="Manuscript", writes=False
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
    if session is not None and command.id == "judge.run":
        result = _execute_judge_run_command(command, normalized_args, None, session)
    elif session is not None and command.id == "judge.repair":
        result = _execute_judge_repair_command(command, normalized_args, None, session)
    elif session is not None and command.id == "judge.approve":
        result = _execute_judge_approve_command(command, normalized_args, None, session)
    elif session is not None and command.id.startswith("bookrun."):
        result = _execute_bookrun_command(command, normalized_args, None, session)
    elif command.id == "canon.refresh":
        result = _execute_canon_refresh_command(command, normalized_args, None)
    elif command.id == "observatory.scan":
        result = _execute_observatory_scan_command(command, normalized_args, None)
    elif command.id == "book.context":
        result = _execute_book_context_command(command, normalized_args, None)
    elif command.id == "plan.mark_written":
        result = _execute_plan_mark_written_command(command, normalized_args, None)
    else:
        result = _accepted_command_result(command, normalized_args, None)

    if session is not None and command.writes:
        return _attach_persistent_audit_event(session, result, normalized_args)
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


def _attach_persistent_audit_event(
    session: Session,
    result: IdeCommandResult,
    args: dict[str, object],
) -> IdeCommandResult:
    """把成功执行的 IDE 写命令沉淀为可查询事件，并用事件 ID 作为审计标识。"""

    workspace_id = _resolve_audit_workspace_id(session, result.payload)
    event = EventLog(
        workspace_id=workspace_id,
        book_id=_int_or_none(result.payload.get("book_id")),
        scene_id=_int_or_none(result.payload.get("scene_id")),
        member_id=None,
        event_type="ide_command_executed",
        source="ide.command_registry",
        payload={
            "command_id": result.command_id,
            "status": result.status,
            "args": redact_sensitive(args),
            "result": redact_sensitive(result.payload),
        },
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return result.model_copy(update={"audit_event_id": f"ide-command-event:{event.id}"})


def _resolve_audit_workspace_id(session: Session, payload: dict[str, object]) -> int:
    """把成功执行的 IDE 写命令沉淀为可查询事件，并用事件 ID 作为审计标识。"""

    book_id = _int_or_none(payload.get("book_id"))
    if book_id is None:
        book_run = payload.get("book_run")
        if isinstance(book_run, dict):
            book_id = _int_or_none(book_run.get("book_id"))
    if book_id is not None:
        book = session.get(Book, book_id)
        if book is not None and book.workspace_id is not None:
            return book.workspace_id

    workspace = session.scalars(select(Workspace).where(Workspace.slug == "storyforge-ide-audit")).first()
    if workspace is None:
        workspace = Workspace(title="StoryForge IDE ??", slug="storyforge-ide-audit", status="active", seat_limit=1)
        session.add(workspace)
        session.flush()
    return workspace.id


def _execute_judge_run_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    session: Session,
) -> IdeCommandResult:
    """把 IDE judge.run 命令转交给结构化评审服务。"""

    try:
        issues = create_judge_issues(session, JudgeIssueCreate(**args))
    except (TypeError, ValueError, JudgeInputError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        {"issues": [JudgeIssueRead.from_issue(issue).model_dump(mode="json") for issue in issues]},
    )


def _execute_judge_repair_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    session: Session,
) -> IdeCommandResult:
    """把 IDE judge.repair 命令转交给定向修复服务。"""

    try:
        patch = create_repair_patch(session, RepairPatchCreate(**args))
    except (TypeError, ValueError, RepairInputError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        {"patch": RepairPatchRead.from_patch(patch).model_dump(mode="json")},
    )


def _execute_judge_approve_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    session: Session,
) -> IdeCommandResult:
    """把 IDE judge.approve 命令转交给 Studio 批准写回服务。"""

    try:
        approval = approve_studio_writeback(session, StudioApprovalExecuteRequest(**args))
    except (TypeError, ValueError, StudioApprovalSummaryNotFoundError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc
    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        {"approval": approval.model_dump(mode="json")},
    )


def _execute_bookrun_command(
    command: IdeCommandDefinition,
    args: dict[str, object],
    audit_event_id: str | None,
    session: Session,
) -> IdeCommandResult:
    """把 IDE bookrun.* 兼容命令转交给 Writing Run seam。"""

    try:
        if command.id == "bookrun.start":
            result = start_writing_run(
                session,
                WritingRunStart(scope="full_book", mode="managed", **args),
            )
        elif command.id == "bookrun.pause":
            result = pause_writing_run(session, book_run_id=_required_book_run_id(args), reason=_optional_reason(args))
        elif command.id == "bookrun.resume":
            result = resume_writing_run(session, book_run_id=_required_book_run_id(args))
        elif command.id == "bookrun.stop":
            result = stop_writing_run(session, book_run_id=_required_book_run_id(args), reason=_optional_reason(args))
        elif command.id == "bookrun.retry_from_checkpoint":
            result = retry_writing_run_from_checkpoint(session, book_run_id=_required_book_run_id(args))
        else:
            raise IdeCommandExecutionError(f"未知 BookRun 命令：{command.id}")
    except (TypeError, ValueError, BookRunError, BookRunBlockedError, BookRunNotFoundError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc

    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        writing_run_payload(result),
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
    """作者接受补丁、正文落盘后把对应章在连载计划里标 done（确定性，无 LLM，不碰手稿）。

    参数缺失才报错；「没改」不是错误——非正文、章不在计划、计划不存在都是正常结果，
    如实带 reason 返回。桌面端据此决定要不要提示，而不是把一次无害的 no-op 弹成失败。
    """

    project_root = args.get("project_root")
    if not isinstance(project_root, str) or not project_root.strip():
        raise IdeCommandExecutionError("plan.mark_written 需要 project_root。")
    file_path = args.get("file_path")
    if not isinstance(file_path, str) or not file_path.strip():
        raise IdeCommandExecutionError("plan.mark_written 需要 file_path。")
    outcome = serial_plan_update.mark_chapter_written(project_root.strip(), file_path.strip())
    return _accepted_command_result(command, args, audit_event_id, {"plan": outcome})


def _required_book_run_id(args: dict[str, object]) -> int:
    """从 IDE 命令参数中读取正整数 BookRun ID。"""

    value = args.get("book_run_id")
    if isinstance(value, int) and value > 0:
        return value
    raise IdeCommandExecutionError("BookRun 命令缺少 book_run_id。")


def _optional_reason(args: dict[str, object]) -> str | None:
    """读取可选中文操作原因，空白内容按未填写处理。"""

    value = args.get("reason")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
