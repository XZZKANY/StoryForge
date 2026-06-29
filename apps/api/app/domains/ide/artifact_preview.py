from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.artifacts.models import Artifact
from app.domains.artifacts.service import get_artifact, read_artifact_download, resolve_artifact_workspace_id
from app.domains.ide._coerce import _context_href, _int_or_none, _string_or_none
from app.domains.ide.schemas import (
    IdeArtifactPreview,
    IdeArtifactPreviewContent,
    IdeArtifactTrace,
    IdeArtifactTraceLink,
    IdeArtifactVersion,
)


def get_artifact_preview(session: Session, artifact_id: int, *, workspace_id: int | None = None) -> IdeArtifactPreview:
    """聚合 IDE Artifact Viewer 所需的预览、下载、版本和追溯信息。"""

    artifact = get_artifact(session, artifact_id)
    download = read_artifact_download(session, artifact_id, workspace_id=workspace_id)
    versions = [
        item
        for item in session.scalars(
            select(Artifact).where(Artifact.lineage_key == artifact.lineage_key).order_by(Artifact.version, Artifact.id)
        ).all()
        if resolve_artifact_workspace_id(session, item) == workspace_id
    ]
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
        return IdeArtifactPreviewContent(
            format="markdown", content_preview=content_preview, summary={"lineage_key": artifact.lineage_key}
        )
    if artifact.mime_type == "application/epub+zip" or artifact.name.endswith(".epub"):
        return IdeArtifactPreviewContent(
            format="epub",
            content_preview=content_preview,
            summary={"manifest": payload.get("manifest", []), "chapter_count": payload.get("chapter_count")},
        )
    if artifact.mime_type == "application/json" or artifact.name.endswith(".json"):
        return IdeArtifactPreviewContent(
            format="json",
            content_preview=json.dumps(payload, ensure_ascii=False)[:500],
            summary={"keys": sorted(payload.keys())},
        )
    return IdeArtifactPreviewContent(
        format="generic", content_preview=content_preview, summary={"lineage_key": artifact.lineage_key}
    )


def _artifact_trace(artifact: Artifact) -> IdeArtifactTrace:
    payload = artifact.payload or {}
    chapter = _first_chapter_trace(payload)
    book_run_id = _int_or_none(payload.get("book_run_id")) or _book_run_id_from_lineage(artifact.lineage_key)
    model_run_id = _int_or_none(payload.get("model_run_id")) or _int_or_none(chapter.get("model_run_id"))
    judge_report_id = _int_or_none(payload.get("judge_report_id")) or _int_or_none(chapter.get("judge_report_id"))
    approved_scene_id = _int_or_none(payload.get("approved_scene_id")) or _int_or_none(chapter.get("approved_scene_id"))
    context_href = _context_href(
        _string_or_none(payload.get("compiled_context_id")) or _string_or_none(chapter.get("compiled_context_id"))
    )
    return IdeArtifactTrace(
        book_run=IdeArtifactTraceLink(
            id=book_run_id,
            href=f"/ide?panel.bottom=runs&book_run={book_run_id}" if book_run_id is not None else None,
            label="Writing Run",
        ),
        model_run=IdeArtifactTraceLink(
            id=model_run_id,
            href=f"/ide?panel.bottom=runs&model_run={model_run_id}" if model_run_id is not None else None,
            context_href=context_href if model_run_id is not None else None,
            label="ModelRun",
        ),
        judge_report=IdeArtifactTraceLink(
            id=judge_report_id,
            href=f"/ide?panel.bottom=problems&judge_report={judge_report_id}" if judge_report_id is not None else None,
            context_href=context_href if judge_report_id is not None else None,
            label="JudgeReport",
        ),
        approve=IdeArtifactTraceLink(
            id=approved_scene_id,
            href=f"/ide?tab=scene:{approved_scene_id}" if approved_scene_id is not None else None,
            context_href=context_href if approved_scene_id is not None else None,
            label="Approve",
        ),
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

