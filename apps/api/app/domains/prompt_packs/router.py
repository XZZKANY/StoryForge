from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.common.pagination import MAX_PAGE_LIMIT, paginate_by_id
from app.db.deps import SessionDependency
from app.domains.prompt_packs.models import PromptPack
from app.domains.prompt_packs.schemas import (
    PromptPackCreate,
    PromptPackListPage,
    PromptPackRead,
    PromptPackUpdate,
)
from app.domains.prompt_packs.service import (
    PromptPackError,
    build_prompt_pack_list_query,
    create_prompt_pack,
    get_prompt_pack_history,
    list_prompt_packs,
    update_prompt_pack,
)

router = APIRouter(prefix="/api/prompt-packs", tags=["Prompt Packs"])


@router.post(
    "",
    response_model=PromptPackRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建 Prompt Pack",
)
def create_prompt_pack_endpoint(payload: PromptPackCreate, session: SessionDependency) -> PromptPackRead:
    """创建 Prompt Pack 首版本，承载创作链路上可复用的提示词集合。"""

    try:
        return create_prompt_pack(session, payload)
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[PromptPackRead] | PromptPackListPage,
    summary="读取 Prompt Pack 列表",
)
def list_prompt_packs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_LIMIT)] = None,
) -> list[PromptPackRead] | PromptPackListPage:
    """Prompt Pack 列表：未指定 limit 时返回兼容数组；指定 limit 时返回游标分页信封。"""

    if limit is None and cursor is None:
        return list(list_prompt_packs(session, workspace_id=workspace_id, book_id=book_id))
    query = build_prompt_pack_list_query(workspace_id=workspace_id, book_id=book_id)
    page = paginate_by_id(session, query, id_column=PromptPack.id, cursor=cursor, limit=limit)
    return PromptPackListPage(
        items=[PromptPackRead.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.patch(
    "/{pack_id}",
    response_model=PromptPackRead,
    summary="更新 Prompt Pack",
)
def update_prompt_pack_endpoint(pack_id: int, payload: PromptPackUpdate, session: SessionDependency) -> PromptPackRead:
    """更新 Prompt Pack 并创建新版本，旧版本保留在历史中。"""

    try:
        return update_prompt_pack(session, pack_id, payload)
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{pack_id}/history",
    response_model=list[PromptPackRead],
    summary="读取 Prompt Pack 历史",
)
def get_prompt_pack_history_endpoint(pack_id: int, session: SessionDependency) -> list[PromptPackRead]:
    """读取 Prompt Pack 同一谱系的全部版本历史。"""

    try:
        return list(get_prompt_pack_history(session, pack_id))
    except PromptPackError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
