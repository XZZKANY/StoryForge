from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.common.exceptions import InputError

from app.db.queries import latest_by_lineage
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import ArtifactCreate
from app.domains.books.models import Book
from app.domains.workspaces.models import Workspace


class ArtifactError(InputError):
    """制品创建或查询的输入不合法。"""


def create_artifact(session: Session, payload: ArtifactCreate) -> Artifact:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ArtifactError("工作区不存在，无法创建制品。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise ArtifactError("作品不存在，无法创建制品。")
    lineage_key = payload.lineage_key or str(uuid4())
    latest_versions = latest_by_lineage(Artifact, filters=[Artifact.lineage_key == lineage_key])
    next_version = int(session.scalar(select(latest_versions.c.latest_version)) or 0) + 1
    artifact = Artifact(
        workspace_id=payload.workspace_id,
        book_id=payload.book_id,
        artifact_type=payload.artifact_type,
        lineage_key=lineage_key,
        name=payload.name,
        status=payload.status,
        storage_uri=payload.storage_uri,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
        payload=payload.payload,
        version=next_version,
    )
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return artifact


def list_artifacts(session: Session, *, workspace_id: int | None = None, book_id: int | None = None) -> Sequence[Artifact]:
    statement = latest_by_lineage(Artifact)
    query = (
        select(Artifact)
        .join(
            statement,
            (Artifact.lineage_key == statement.c.lineage_key) & (Artifact.version == statement.c.latest_version),
        )
        .order_by(Artifact.id)
    )
    if workspace_id is not None:
        query = query.where(Artifact.workspace_id == workspace_id)
    if book_id is not None:
        query = query.where(Artifact.book_id == book_id)
    return session.scalars(query).all()

