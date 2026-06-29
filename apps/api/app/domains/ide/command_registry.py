from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
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
        IdeCommandDefinition(id="bookrun.start", title="启动写作任务", category="Writing Run"),
        IdeCommandDefinition(id="bookrun.pause", title="暂停写作任务", category="Writing Run"),
        IdeCommandDefinition(id="bookrun.resume", title="恢复写作任务", category="Writing Run"),
        IdeCommandDefinition(id="bookrun.stop", title="停止写作任务", category="Writing Run"),
        IdeCommandDefinition(id="bookrun.retry_from_checkpoint", title="从 checkpoint 重试写作任务", category="Writing Run"),
        IdeCommandDefinition(id="audit.open", title="打开审计记录", category="Audit", writes=False),
        IdeCommandDefinition(id="memory.resolve_conflict", title="仲裁记忆冲突", category="Story Memory"),
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
        "args": args,
    }
    if extra_payload:
        payload.update(extra_payload)
    return IdeCommandResult(
        command_id=command.id,
        status="accepted",
        audit_event_id=audit_event_id,
        payload=payload,
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
            "args": args,
            "result": result.payload,
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
