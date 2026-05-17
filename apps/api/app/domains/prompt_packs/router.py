from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.prompt_packs.schemas import PromptPackCreate, PromptPackRead, PromptPackUpdate
from app.domains.prompt_packs.service import (
    PromptPackError,
    create_prompt_pack,
    get_prompt_pack_history,
    list_prompt_packs,
    update_prompt_pack,
)

router = APIRouter(prefix="/api/prompt-packs", tags=["Prompt Packs"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=PromptPackRead, status_code=status.HTTP_201_CREATED)
def create_prompt_pack_endpoint(payload: PromptPackCreate, session: SessionDependency) -> PromptPackRead:
    try:
        return create_prompt_pack(session, payload)
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("", response_model=list[PromptPackRead])
def list_prompt_packs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[PromptPackRead]:
    return list(list_prompt_packs(session, workspace_id=workspace_id, book_id=book_id))


@router.patch("/{pack_id}", response_model=PromptPackRead)
def update_prompt_pack_endpoint(pack_id: int, payload: PromptPackUpdate, session: SessionDependency) -> PromptPackRead:
    try:
        return update_prompt_pack(session, pack_id, payload)
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{pack_id}/history", response_model=list[PromptPackRead])
def get_prompt_pack_history_endpoint(pack_id: int, session: SessionDependency) -> list[PromptPackRead]:
    try:
        return list(get_prompt_pack_history(session, pack_id))
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

