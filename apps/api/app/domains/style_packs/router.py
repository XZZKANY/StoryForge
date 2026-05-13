from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.assets.service import AssetNotFoundError, BookNotFoundError, EmptyAssetUpdateError
from app.domains.style_packs.schemas import (
    EffectiveStyleRulesRead,
    StylePackApplicationRead,
    StylePackApplyCreate,
    StylePackCreate,
    StylePackRead,
    StylePackUpdate,
)
from app.domains.style_packs.service import (
    StylePackInputError,
    apply_style_pack,
    create_style_pack,
    get_effective_style_rules,
    update_style_pack,
)

router = APIRouter(prefix="/api/style-packs", tags=["风格包"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=StylePackRead, status_code=status.HTTP_201_CREATED)
def create_style_pack_endpoint(payload: StylePackCreate, session: SessionDependency) -> StylePackRead:
    """创建可复用风格包。"""

    try:
        return create_style_pack(session, payload)
    except BookNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{asset_id}", response_model=StylePackRead)
def update_style_pack_endpoint(asset_id: int, payload: StylePackUpdate, session: SessionDependency) -> StylePackRead:
    """更新风格包并创建新版本。"""

    try:
        return update_style_pack(session, asset_id, payload)
    except (AssetNotFoundError, StylePackInputError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmptyAssetUpdateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{asset_id}/applications", response_model=StylePackApplicationRead, status_code=status.HTTP_201_CREATED)
def apply_style_pack_endpoint(
    asset_id: int,
    payload: StylePackApplyCreate,
    session: SessionDependency,
) -> StylePackApplicationRead:
    """把风格包应用到系列、作品或场景。"""

    try:
        return apply_style_pack(session, asset_id, payload)
    except StylePackInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/effective-rules", response_model=EffectiveStyleRulesRead)
def read_effective_style_rules_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    scene_id: Annotated[int | None, Query(gt=0)] = None,
) -> EffectiveStyleRulesRead:
    """读取作品或场景生效的风格规则。"""

    try:
        return get_effective_style_rules(session, book_id=book_id, scene_id=scene_id)
    except StylePackInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
