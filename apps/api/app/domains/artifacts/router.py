from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.common.pagination import MAX_PAGE_LIMIT, paginate_by_id
from app.db.deps import SessionDependency
from app.domains.artifacts.models import Artifact
from app.domains.artifacts.schemas import (
    ArtifactCreate,
    ArtifactDownloadRead,
    ArtifactListPage,
    ArtifactRead,
)
from app.domains.artifacts.service import (
    ArtifactError,
    ArtifactNotFoundError,
    build_artifact_list_query,
    create_artifact,
    get_artifact,
    list_artifacts_cached,
    read_artifact_download,
)

router = APIRouter(prefix="/api/artifacts", tags=["制品中心"])


@router.post(
    "",
    response_model=ArtifactRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建制品",
)
def create_artifact_endpoint(payload: ArtifactCreate, session: SessionDependency) -> ArtifactRead:
    """登记一条制品记录（草稿、章节稿、评测报告等），返回新建后的元数据。"""

    try:
        return create_artifact(session, payload)
    except ArtifactError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[ArtifactRead] | ArtifactListPage,
    summary="读取制品列表",
)
def list_artifacts_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_LIMIT)] = None,
) -> list[ArtifactRead] | ArtifactListPage:
    """制品列表：未指定 limit 时返回兼容的扁平数组；指定 limit 时返回游标分页信封。"""

    if limit is None and cursor is None:
        return list_artifacts_cached(session, workspace_id=workspace_id, book_id=book_id)
    query = build_artifact_list_query(workspace_id=workspace_id, book_id=book_id)
    page = paginate_by_id(
        session,
        query,
        id_column=Artifact.id,
        cursor=cursor,
        limit=limit,
    )
    return ArtifactListPage(
        items=[ArtifactRead.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.get(
    "/{artifact_id}",
    response_model=ArtifactRead,
    summary="读取制品详情",
)
def get_artifact_endpoint(artifact_id: int, session: SessionDependency) -> ArtifactRead:
    """按主键读取单个制品的完整元数据。"""

    try:
        return get_artifact(session, artifact_id)
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/{artifact_id}/download",
    response_model=ArtifactDownloadRead,
    summary="读取制品下载摘要",
)
def download_artifact_endpoint(artifact_id: int, session: SessionDependency) -> ArtifactDownloadRead:
    """返回制品下载摘要（路径、大小、校验信息），实际签名 URL 由对象存储后端二次签发。"""

    try:
        return read_artifact_download(session, artifact_id)
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
