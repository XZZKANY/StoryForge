from __future__ import annotations

import os
from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.redis_cache import cache_delete_pattern, cache_get_value, cache_set_value
from app.db.queries import latest_by_lineage
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import ArtifactCreate, ArtifactDownloadRead, ArtifactRead
from app.domains.books.models import Book
from app.domains.workspaces.models import Workspace

DEFAULT_ARTIFACT_LIST_CACHE_TTL = 60


def _artifact_list_cache_key(workspace_id: int | None, book_id: int | None) -> str:
    workspace_part = "all" if workspace_id is None else str(workspace_id)
    book_part = "all" if book_id is None else str(book_id)
    return f"storyforge:artifact-list:workspace:{workspace_part}:book:{book_part}"


def _artifact_list_cache_ttl_seconds() -> int:
    raw_value = os.getenv("STORYFORGE_ARTIFACT_CACHE_TTL_SECONDS", str(DEFAULT_ARTIFACT_LIST_CACHE_TTL))
    try:
        value = int(raw_value)
    except ValueError:
        return DEFAULT_ARTIFACT_LIST_CACHE_TTL
    return value if value > 0 else DEFAULT_ARTIFACT_LIST_CACHE_TTL


def _invalidate_artifact_list_cache() -> None:
    cache_delete_pattern("storyforge:artifact-list:*")


class ArtifactError(InputError):
    """制品创建或查询的输入不合法。"""


class ArtifactNotFoundError(ArtifactError):
    """制品不存在时由路由层转换为可重试的 404。"""


class ArtifactForbiddenError(ArtifactError):
    """制品不属于请求工作区时由路由层转换为 403。"""


def create_artifact(session: Session, payload: ArtifactCreate) -> Artifact:
    if payload.workspace_id is not None and session.get(Workspace, payload.workspace_id) is None:
        raise ArtifactError("工作区不存在，无法创建制品。")
    book = session.get(Book, payload.book_id) if payload.book_id is not None else None
    if payload.book_id is not None and book is None:
        raise ArtifactError("作品不存在，无法创建制品。")
    book_workspace_id = _artifact_book_workspace_id(book)
    if payload.workspace_id is not None and book_workspace_id is not None and payload.workspace_id != book_workspace_id:
        raise ArtifactError("作品与制品工作区不匹配，无法创建制品。")
    workspace_id = payload.workspace_id if payload.workspace_id is not None else book_workspace_id
    lineage_key = payload.lineage_key or str(uuid4())
    latest_versions = latest_by_lineage(Artifact, filters=[Artifact.lineage_key == lineage_key])
    next_version = int(session.scalar(select(latest_versions.c.latest_version)) or 0) + 1
    artifact = Artifact(
        workspace_id=workspace_id,
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
    _invalidate_artifact_list_cache()
    return artifact


def list_artifacts(
    session: Session, *, workspace_id: int | None = None, book_id: int | None = None
) -> Sequence[Artifact]:
    query = build_artifact_list_query(workspace_id=workspace_id, book_id=book_id)
    return session.scalars(query).all()


def list_artifacts_cached(
    session: Session,
    *,
    workspace_id: int | None = None,
    book_id: int | None = None,
) -> list[ArtifactRead]:
    """Redis 缓存命中时直接返回 ArtifactRead；未命中时落库并写入缓存。"""

    cache_key = _artifact_list_cache_key(workspace_id, book_id)
    cached = cache_get_value(cache_key)
    if isinstance(cached, list):
        try:
            return [ArtifactRead.model_validate(item) for item in cached]
        except Exception:
            cache_delete_pattern(cache_key)
    artifacts = list_artifacts(session, workspace_id=workspace_id, book_id=book_id)
    rendered = [ArtifactRead.model_validate(item) for item in artifacts]
    cache_set_value(
        cache_key,
        [item.model_dump(mode="json") for item in rendered],
        _artifact_list_cache_ttl_seconds(),
    )
    return rendered


def build_artifact_list_query(*, workspace_id: int | None = None, book_id: int | None = None):
    """返回未执行的最新版制品列表查询，便于分页 helper 接入主键游标。"""

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
    return query


def get_artifact(session: Session, artifact_id: int, *, workspace_id: int | None = None) -> Artifact:
    """按 ID 读取单个制品详情，不触发对象存储下载。"""

    artifact = session.get(Artifact, artifact_id)
    if artifact is None:
        raise ArtifactNotFoundError("制品不存在，无法读取详情。")
    artifact_workspace_id = resolve_artifact_workspace_id(session, artifact)
    if workspace_id is not None and artifact_workspace_id != workspace_id:
        raise ArtifactForbiddenError("制品工作区不匹配，禁止读取。")
    return artifact


def read_artifact_download(
    session: Session,
    artifact_id: int,
    *,
    workspace_id: int | None = None,
) -> ArtifactDownloadRead:
    """返回可下载内容摘要；S3 artifact 返回 presigned URL，memory:// 返回内联预览。"""

    from app.common.s3_client import generate_presigned_get_url, presigned_url_expires_at

    artifact = get_artifact(session, artifact_id)
    artifact_workspace_id = resolve_artifact_workspace_id(session, artifact)
    if workspace_id is not None and artifact_workspace_id != workspace_id:
        raise ArtifactForbiddenError("制品工作区不匹配，禁止下载。")

    # S3 artifact → presigned URL (5 分钟有效期)
    if artifact.storage_uri.startswith("s3://"):
        presigned_url = generate_presigned_get_url(artifact.storage_uri, ttl_seconds=300)
        if presigned_url:
            return ArtifactDownloadRead(
                id=artifact.id,
                artifact_type=artifact.artifact_type,
                name=artifact.name,
                mime_type=artifact.mime_type,
                storage_uri=artifact.storage_uri,
                download_mode="presigned_url",
                content_preview="",
                payload_summary={},
                presigned_url=presigned_url,
                expires_at=presigned_url_expires_at(300),
            )

    # memory:// 或 presigned 失败 → payload_preview
    payload_summary = dict(artifact.payload or {})
    return ArtifactDownloadRead(
        id=artifact.id,
        artifact_type=artifact.artifact_type,
        name=artifact.name,
        mime_type=artifact.mime_type,
        storage_uri=artifact.storage_uri,
        download_mode="payload_preview",
        content_preview=_artifact_content_preview(artifact),
        payload_summary=payload_summary,
    )


def _artifact_content_preview(artifact: Artifact) -> str:
    payload = artifact.payload or {}
    for key in ("content", "text", "summary", "body"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value[:500]
    return f"{artifact.name}（{artifact.artifact_type}，v{artifact.version}）"


def resolve_artifact_workspace_id(session: Session, artifact: Artifact) -> int | None:
    if artifact.workspace_id is not None:
        return artifact.workspace_id
    if artifact.book_id is None:
        return None
    return _artifact_book_workspace_id(session.get(Book, artifact.book_id))


def _artifact_book_workspace_id(book: Book | None) -> int | None:
    return book.workspace_id if book is not None else None
