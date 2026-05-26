from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.common.metrics import repair_patches_total
from app.db.deps import SessionDependency
from app.domains.repair.schemas import RepairPatchCreate, RepairPatchRead
from app.domains.repair.service import RepairInputError, create_repair_patch

router = APIRouter(prefix="/api/repair", tags=["定向修复"])


@router.post("/patches", response_model=RepairPatchRead, status_code=status.HTTP_201_CREATED)
def create_repair_patch_endpoint(payload: RepairPatchCreate, session: SessionDependency) -> RepairPatchRead:
    """根据结构化问题单生成局部替换补丁，修复后必须重新评审。"""

    try:
        patch = create_repair_patch(session, payload)
    except RepairInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    repair_patches_total.inc()
    return RepairPatchRead.from_patch(patch)
