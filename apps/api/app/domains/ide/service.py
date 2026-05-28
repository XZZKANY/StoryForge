from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.artifacts.models import Artifact
from app.domains.artifacts.service import get_artifact, read_artifact_download
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunCreate, BookRunRead
from app.domains.book_runs.service import (
    BookRunBlockedError,
    BookRunError,
    BookRunNotFoundError,
    create_book_run,
    pause_book_run,
    resume_book_run,
    retry_book_run_from_checkpoint,
    stop_book_run,
)
from app.domains.books.models import Book, Chapter, Scene
from app.domains.context_compiler.service import get_compiled_context_record
from app.domains.events.models import EventLog
from app.domains.ide.schemas import (
    IdeArtifactPreview,
    IdeArtifactPreviewContent,
    IdeArtifactTrace,
    IdeArtifactTraceLink,
    IdeArtifactVersion,
    IdeCommandResult,
    IdeContextBlockRef,
    IdeContextBudget,
    IdeContextSnapshot,
    IdeDiagnostic,
    IdeDiagnosticRange,
    IdeQuickFix,
    IdeRunEvent,
    IdeSceneRead,
    IdeStoryMemoryConflict,
    IdeStoryMemoryItem,
    IdeStoryMemoryQuery,
    IdeStoryMemoryQueryResult,
    IdeTreeNode,
    IdeWorkspaceTree,
)
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate, JudgeIssueRead
from app.domains.judge.service import JudgeInputError, create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate, RepairPatchRead
from app.domains.repair.service import RepairInputError, create_repair_patch
from app.domains.story_memory.schemas import MemoryAtom, MemoryConflict
from app.domains.story_memory.service import detect_memory_conflicts, list_memory_atoms
from app.domains.studio.schemas import StudioApprovalExecuteRequest
from app.domains.studio.service import StudioApprovalSummaryNotFoundError, approve_studio_writeback
from app.domains.workspaces.models import Workspace


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
        IdeCommandDefinition(id="bookrun.start", title="启动 BookRun", category="BookRun"),
        IdeCommandDefinition(id="bookrun.pause", title="暂停 BookRun", category="BookRun"),
        IdeCommandDefinition(id="bookrun.resume", title="恢复 BookRun", category="BookRun"),
        IdeCommandDefinition(id="bookrun.stop", title="停止 BookRun", category="BookRun"),
        IdeCommandDefinition(id="bookrun.retry_from_checkpoint", title="从 checkpoint 重试", category="BookRun"),
        IdeCommandDefinition(id="audit.open", title="打开审计记录", category="Audit", writes=False),
        IdeCommandDefinition(id="memory.resolve_conflict", title="仲裁记忆冲突", category="Story Memory"),
    ]
}


class IdeCommandNotFoundError(Exception):
    """命令目录中不存在指定命令。"""


class IdeCommandExecutionError(Exception):
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
    """把 IDE bookrun.* 命令转交给 BookRun 领域状态机。"""

    try:
        if command.id == "bookrun.start":
            book_run = create_book_run(session, BookRunCreate(**args))
        elif command.id == "bookrun.pause":
            book_run = pause_book_run(session, _required_book_run_id(args), _optional_reason(args))
        elif command.id == "bookrun.resume":
            book_run = resume_book_run(session, _required_book_run_id(args))
        elif command.id == "bookrun.stop":
            book_run = stop_book_run(session, _required_book_run_id(args), _optional_reason(args))
        elif command.id == "bookrun.retry_from_checkpoint":
            book_run = retry_book_run_from_checkpoint(session, _required_book_run_id(args))
        else:
            raise IdeCommandExecutionError(f"未知 BookRun 命令：{command.id}")
    except (TypeError, ValueError, BookRunError, BookRunBlockedError, BookRunNotFoundError) as exc:
        raise IdeCommandExecutionError(str(exc)) from exc

    return _accepted_command_result(
        command,
        args,
        audit_event_id,
        {"book_run": BookRunRead.model_validate(book_run).model_dump(mode="json")},
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


def get_artifact_preview(session: Session, artifact_id: int) -> IdeArtifactPreview:
    """聚合 IDE Artifact Viewer 所需的预览、下载、版本和追溯信息。"""

    artifact = get_artifact(session, artifact_id)
    download = read_artifact_download(session, artifact_id)
    versions = session.scalars(
        select(Artifact).where(Artifact.lineage_key == artifact.lineage_key).order_by(Artifact.version, Artifact.id)
    ).all()
    return IdeArtifactPreview(
        artifact={
            "id": artifact.id,
            "workspace_id": artifact.workspace_id,
            "book_id": artifact.book_id,
            "artifact_type": artifact.artifact_type,
            "lineage_key": artifact.lineage_key,
            "name": artifact.name,
            "status": artifact.status,
            "storage_uri": artifact.storage_uri,
            "mime_type": artifact.mime_type,
            "size_bytes": artifact.size_bytes,
            "version": artifact.version,
        },
        preview=_artifact_preview_content(artifact, download.content_preview),
        download=download.model_dump(mode="json"),
        versions=[
            IdeArtifactVersion(
                id=item.id,
                version=item.version,
                name=item.name,
                status=item.status,
                created_at=item.created_at.isoformat(),
            )
            for item in versions
        ],
        trace=_artifact_trace(artifact),
    )


def _artifact_preview_content(artifact: Artifact, content_preview: str) -> IdeArtifactPreviewContent:
    payload = artifact.payload or {}
    if artifact.mime_type == "text/markdown" or artifact.name.endswith(".md"):
        return IdeArtifactPreviewContent(format="markdown", content_preview=content_preview, summary={"lineage_key": artifact.lineage_key})
    if artifact.mime_type == "application/epub+zip" or artifact.name.endswith(".epub"):
        return IdeArtifactPreviewContent(format="epub", content_preview=content_preview, summary={"manifest": payload.get("manifest", []), "chapter_count": payload.get("chapter_count")})
    if artifact.mime_type == "application/json" or artifact.name.endswith(".json"):
        return IdeArtifactPreviewContent(format="json", content_preview=json.dumps(payload, ensure_ascii=False)[:500], summary={"keys": sorted(payload.keys())})
    return IdeArtifactPreviewContent(format="generic", content_preview=content_preview, summary={"lineage_key": artifact.lineage_key})


def _artifact_trace(artifact: Artifact) -> IdeArtifactTrace:
    payload = artifact.payload or {}
    chapter = _first_chapter_trace(payload)
    book_run_id = _int_or_none(payload.get("book_run_id")) or _book_run_id_from_lineage(artifact.lineage_key)
    model_run_id = _int_or_none(payload.get("model_run_id")) or _int_or_none(chapter.get("model_run_id"))
    judge_report_id = _int_or_none(payload.get("judge_report_id")) or _int_or_none(chapter.get("judge_report_id"))
    approved_scene_id = _int_or_none(payload.get("approved_scene_id")) or _int_or_none(chapter.get("approved_scene_id"))
    context_href = _context_href(_string_or_none(payload.get("compiled_context_id")) or _string_or_none(chapter.get("compiled_context_id")))
    return IdeArtifactTrace(
        book_run=IdeArtifactTraceLink(id=book_run_id, href=f"/ide?panel.bottom=runs&book_run={book_run_id}" if book_run_id is not None else None, label="BookRun"),
        model_run=IdeArtifactTraceLink(id=model_run_id, href=f"/ide?panel.bottom=runs&model_run={model_run_id}" if model_run_id is not None else None, context_href=context_href if model_run_id is not None else None, label="ModelRun"),
        judge_report=IdeArtifactTraceLink(id=judge_report_id, href=f"/ide?panel.bottom=problems&judge_report={judge_report_id}" if judge_report_id is not None else None, context_href=context_href if judge_report_id is not None else None, label="JudgeReport"),
        approve=IdeArtifactTraceLink(id=approved_scene_id, href=f"/ide?tab=scene:{approved_scene_id}" if approved_scene_id is not None else None, context_href=context_href if approved_scene_id is not None else None, label="Approve"),
    )


def _first_chapter_trace(payload: dict[str, object]) -> dict[str, object]:
    for key in ("chapters", "completed_chapters"):
        rows = payload.get(key)
        if isinstance(rows, list):
            for item in rows:
                if isinstance(item, dict):
                    return item
    return {}


def _book_run_id_from_lineage(lineage_key: str) -> int | None:
    parts = lineage_key.split(":")
    if len(parts) >= 2 and parts[0] == "book-run":
        return _int_or_none(parts[1])
    return None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _string_or_none(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _context_href(compiled_context_id: str | None) -> str | None:
    return f"/ide?inspector={compiled_context_id}" if compiled_context_id else None


def get_workspace_tree(session: Session) -> IdeWorkspaceTree:
    """读取作品与章节并组装为 IDE Explorer 的三层树。"""

    books = session.scalars(select(Book).order_by(Book.id)).all()
    chapters = session.scalars(select(Chapter).order_by(Chapter.book_id, Chapter.ordinal, Chapter.id)).all()
    chapters_by_book: dict[int, list[Chapter]] = {}
    for chapter in chapters:
        chapters_by_book.setdefault(chapter.book_id, []).append(chapter)

    root = IdeTreeNode(id="workspace:default", type="workspace", title="StoryForge 工作区")
    for book in books:
        book_node = IdeTreeNode(id=f"book:{book.id}", type="book", title=book.title, ref_id=book.id)
        for chapter in chapters_by_book.get(book.id, []):
            book_node.children.append(
                IdeTreeNode(
                    id=f"chapter:{chapter.id}",
                    type="chapter",
                    title=f"第 {chapter.ordinal} 章：{chapter.title}",
                    ref_id=chapter.id,
                )
            )
        root.children.append(book_node)

    ordered_nodes: list[IdeTreeNode] = []

    def visit(node: IdeTreeNode) -> None:
        ordered_nodes.append(node)
        for child in node.children:
            visit(child)

    visit(root)
    return IdeWorkspaceTree(root=root, nodes=ordered_nodes)


def read_ide_scene(session: Session, scene_id: int) -> IdeSceneRead | None:
    """读取 IDE 章节编辑器和修复工作流需要的场景正文。"""

    row = session.execute(
        select(Scene, Chapter.book_id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(Scene.id == scene_id)
    ).first()
    if row is None:
        return None
    scene, book_id = row
    return IdeSceneRead(
        id=scene.id,
        chapter_id=scene.chapter_id,
        book_id=book_id,
        title=scene.title,
        status=scene.status,
        content=scene.content or "",
    )


def _diagnostic_severity(severity: str) -> str:
    """把 Judge 严重级别压缩为编辑器诊断级别。"""

    normalized = severity.lower()
    if normalized in {"blocking", "high"}:
        return "error"
    if normalized == "medium":
        return "warning"
    if normalized == "low":
        return "info"
    return "hint"


def list_diagnostics_for_scene(session: Session, scene_id: int) -> list[IdeDiagnostic]:
    """读取开放 JudgeIssue 并映射为 IDE Problems 契约。"""

    issues = session.scalars(
        select(JudgeIssue)
        .where(JudgeIssue.scene_id == scene_id, JudgeIssue.status == "open")
        .order_by(JudgeIssue.id)
    ).all()
    diagnostics: list[IdeDiagnostic] = []
    for issue in issues:
        payload = issue.payload or {}
        diagnostics.append(
            IdeDiagnostic(
                id=f"judge:{issue.id}",
                severity=_diagnostic_severity(issue.severity),
                code=issue.issue_type,
                message=issue.description,
                range=IdeDiagnosticRange(
                    start=int(payload.get("span_start", 0)),
                    end=int(payload.get("span_end", 0)),
                ),
                evidence=[
                    {"source_ref": str(item.get("source_ref", "")), "quote": str(item.get("quote", ""))}
                    for item in payload.get("evidence_links", [])
                    if isinstance(item, dict)
                ],
                quickFixes=[
                    IdeQuickFix(
                        command_id="judge.repair",
                        title="生成定向修复",
                        args={"issue_id": issue.id, "scene_id": issue.scene_id},
                    )
                ],
            )
        )
    return diagnostics

def get_context_snapshot(session: Session, compiled_context_id: str) -> IdeContextSnapshot | None:
    """按 compiled_context_id 读取 Context Inspector 所需快照。"""

    record = get_compiled_context_record(session, compiled_context_id)
    if record is None:
        return None

    budget_report = record.budget_report or {}
    block_refs = record.block_refs or {}
    return IdeContextSnapshot(
        compiled_context_id=record.compiled_context_id,
        book_id=record.book_id,
        chapter_id=record.chapter_id,
        scene_id=record.scene_id,
        budget=IdeContextBudget(
            token_budget=int(budget_report.get("token_budget", record.token_budget)),
            used_tokens=int(budget_report.get("used_tokens", record.used_tokens)),
            dropped_tokens=int(budget_report.get("dropped_tokens", record.dropped_tokens)),
            truncated=bool(budget_report.get("truncated", record.dropped_count > 0)),
        ),
        injected_blocks=[_context_block_ref(item) for item in block_refs.get("injected", []) if isinstance(item, dict)],
        dropped_blocks=[_context_block_ref(item) for item in block_refs.get("dropped", []) if isinstance(item, dict)],
        debug_summary=[str(item) for item in (record.debug_summary or [])],
    )


def _context_block_ref(item: dict[str, object]) -> IdeContextBlockRef:
    """从持久化 JSON 字典恢复上下文块引用。"""

    order_value = item.get("order")
    return IdeContextBlockRef(
        block_id=str(item.get("block_id", "")),
        kind=str(item.get("kind", "")),
        source_ref=str(item.get("source_ref", "")),
        token_count=int(item.get("token_count", 0)),
        priority=str(item.get("priority", "")),
        reason=str(item.get("reason", "")),
        order=int(order_value) if order_value is not None else None,
    )

def query_story_memory(session: Session, payload: IdeStoryMemoryQuery) -> IdeStoryMemoryQueryResult:
    """按 IDE 过滤条件查询长效记忆和冲突队列。"""

    atoms = list_memory_atoms(
        session,
        book_id=payload.book_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        fact_type=payload.fact_type,
    )
    if payload.chapter is not None:
        atoms = [atom for atom in atoms if _memory_active_at(atom, payload.chapter)]

    conflicts = detect_memory_conflicts(atoms)
    conflict_ids_by_memory = _conflict_ids_by_memory(conflicts)
    if payload.conflict_status == "conflicted":
        atoms = [atom for atom in atoms if atom.memory_id in conflict_ids_by_memory]
    elif payload.conflict_status == "clean":
        atoms = [atom for atom in atoms if atom.memory_id not in conflict_ids_by_memory]

    items = [_story_memory_item(atom, conflict_ids_by_memory.get(atom.memory_id, [])) for atom in atoms]
    return IdeStoryMemoryQueryResult(
        filters=payload,
        items=items,
        conflict_queue=[_story_memory_conflict(conflict) for conflict in conflicts],
        total=len(items),
        conflicted_count=sum(1 for item in items if item.conflict_ids),
    )


def _memory_active_at(atom: MemoryAtom, chapter: int) -> bool:
    if chapter < atom.valid_from_chapter:
        return False
    return atom.valid_to_chapter is None or chapter <= atom.valid_to_chapter


def _conflict_ids_by_memory(conflicts: list[MemoryConflict]) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for conflict in conflicts:
        mapping.setdefault(conflict.left_memory_id, []).append(conflict.conflict_id)
        mapping.setdefault(conflict.right_memory_id, []).append(conflict.conflict_id)
    return mapping


def _story_memory_item(atom: MemoryAtom, conflict_ids: list[str]) -> IdeStoryMemoryItem:
    return IdeStoryMemoryItem(
        memory_id=atom.memory_id,
        entity_type=atom.entity_type,
        entity_id=atom.entity_id,
        fact_type=atom.fact_type,
        value=atom.value,
        source_ref=atom.source_ref,
        source_chapter_id=atom.source_chapter_id,
        valid_from_chapter=atom.valid_from_chapter,
        valid_to_chapter=atom.valid_to_chapter,
        confidence=atom.confidence,
        immutable=atom.immutable,
        revision=atom.revision,
        conflict_ids=conflict_ids,
    )


def _story_memory_conflict(conflict: MemoryConflict) -> IdeStoryMemoryConflict:
    return IdeStoryMemoryConflict(
        conflict_id=conflict.conflict_id,
        entity_id=conflict.entity_id,
        fact_type=conflict.fact_type,
        left_memory_id=conflict.left_memory_id,
        right_memory_id=conflict.right_memory_id,
        severity=conflict.severity,
        reason=conflict.reason,
        source_refs=conflict.source_refs,
    )

def build_run_events(book_run: BookRun) -> list[IdeRunEvent]:
    """从 BookRun 聚合状态投影 IDE Run Panel 事件列表。"""

    progress = book_run.progress or {}
    completed = [item for item in progress.get("completed_chapters", []) if isinstance(item, dict)]
    events = [
        IdeRunEvent(
            event="progress",
            data={
                "book_run_id": book_run.id,
                "status": book_run.status,
                "current_chapter_index": book_run.current_chapter_index,
                "total_chapters": book_run.total_chapters,
                "completed_count": len(completed),
            },
        )
    ]
    if book_run.checkpoint:
        events.append(
            IdeRunEvent(
                event="checkpoint",
                data={
                    "book_run_id": book_run.id,
                    "latest_checkpoint": book_run.checkpoint[-1],
                    "checkpoint": book_run.checkpoint,
                },
            )
        )
    blocked_chapter = progress.get("blocked_chapter")
    if isinstance(blocked_chapter, dict):
        events.append(IdeRunEvent(event="blocked", data={"book_run_id": book_run.id, "blocked_chapter": blocked_chapter}))
    events.append(
        IdeRunEvent(
            event="budget",
            data={
                "book_run_id": book_run.id,
                "token_budget": book_run.token_budget,
                "tokens_used": book_run.tokens_used,
                "tokens_remaining": _tokens_remaining(book_run),
                "elapsed_time_sec": book_run.elapsed_time_sec,
                "time_budget_sec": book_run.time_budget_sec,
                "estimated_cost": book_run.estimated_cost,
            },
        )
    )
    provider_fallback = progress.get("provider_fallback")
    if isinstance(provider_fallback, dict):
        events.append(IdeRunEvent(event="provider_fallback", data={"book_run_id": book_run.id, "provider_fallback": provider_fallback}))
    if book_run.status == "completed":
        events.append(IdeRunEvent(event="completed", data={"book_run_id": book_run.id, "completed_count": len(completed)}))
    return events


def encode_sse_event(event: str, data: dict[str, object]) -> str:
    """编码单条 SSE 事件文本。"""

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _tokens_remaining(book_run: BookRun) -> int | None:
    if book_run.token_budget is None:
        return None
    return max(0, book_run.token_budget - book_run.tokens_used)
