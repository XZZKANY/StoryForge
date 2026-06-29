from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene
from app.domains.ide.schemas import (
    IdeDiagnostic,
    IdeDiagnosticRange,
    IdeQuickFix,
    IdeSceneRead,
    IdeTreeNode,
    IdeWorkspaceTree,
)
from app.domains.judge.models import JudgeIssue


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
        select(Scene, Chapter.book_id).join(Chapter, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id)
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
        select(JudgeIssue).where(JudgeIssue.scene_id == scene_id, JudgeIssue.status == "open").order_by(JudgeIssue.id)
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
