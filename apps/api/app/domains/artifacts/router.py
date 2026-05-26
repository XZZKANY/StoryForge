from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.artifacts.schemas import ArtifactCreate, ArtifactDownloadRead, ArtifactRead
from app.domains.artifacts.service import (
    ArtifactError,
    ArtifactNotFoundError,
    create_artifact,
    get_artifact,
    list_artifacts,
    read_artifact_download,
)

router = APIRouter(prefix="/api/artifacts", tags=["制品中心"])


@router.post("", response_model=ArtifactRead, status_code=status.HTTP_201_CREATED)
def create_artifact_endpoint(payload: ArtifactCreate, session: SessionDependency) -> ArtifactRead:
    try:
        return create_artifact(session, payload)
    except ArtifactError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("", response_model=list[ArtifactRead])
def list_artifacts_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[ArtifactRead]:
    return list(list_artifacts(session, workspace_id=workspace_id, book_id=book_id))


@router.get("/{artifact_id}", response_model=ArtifactRead)
def get_artifact_endpoint(artifact_id: int, session: SessionDependency) -> ArtifactRead:
    try:
        return get_artifact(session, artifact_id)
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{artifact_id}/download", response_model=ArtifactDownloadRead)
def download_artifact_endpoint(artifact_id: int, session: SessionDependency) -> ArtifactDownloadRead:
    try:
        return read_artifact_download(session, artifact_id)
    except ArtifactNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

