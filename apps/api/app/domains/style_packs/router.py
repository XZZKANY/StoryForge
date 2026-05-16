from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.style_packs.schemas import (
    StylePackApplyCreate,
    StylePackCreate,
    StylePackRead,
    StylePackUpdate,
    StyleRuleRead,
)
from app.domains.style_packs.service import (
    StylePackBookNotFoundError,
    StylePackInputError,
    StylePackNotFoundError,
    apply_style_pack,
    create_style_pack,
    list_style_packs,
    update_style_pack,
)

router = APIRouter(prefix="/api/style-packs", tags=["风格包"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=StylePackRead, status_code=status.HTTP_201_CREATED)
def create_style_pack_endpoint(payload: StylePackCreate, session: SessionDependency) -> StylePackRead:
    """创建风格包首版本。"""

    try:
        return create_style_pack(session, payload)
    except StylePackBookNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("", response_model=list[StylePackRead])
def list_style_packs_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
) -> list[StylePackRead]:
    """读取作品下最新风格包列表。"""

    return list(list_style_packs(session, book_id))


@router.patch("/{asset_id}", response_model=StylePackRead)
def update_style_pack_endpoint(asset_id: int, payload: StylePackUpdate, session: SessionDependency) -> StylePackRead:
    """更新风格包并创建新版本。"""

    try:
        return update_style_pack(session, asset_id, payload)
    except StylePackNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StylePackInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{asset_id}/apply", response_model=StyleRuleRead, status_code=status.HTTP_201_CREATED)
def apply_style_pack_endpoint(
    asset_id: int,
    payload: StylePackApplyCreate,
    session: SessionDependency,
) -> StyleRuleRead:
    """把风格包复制为作品级 style_rule 资产。"""

    try:
        return apply_style_pack(session, asset_id, payload)
    except (StylePackNotFoundError, StylePackBookNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StylePackInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
