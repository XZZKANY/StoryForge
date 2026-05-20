from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.artifacts.schemas import ArtifactCreate, ArtifactRead
from app.domains.artifacts.service import ArtifactError, create_artifact, list_artifacts

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

