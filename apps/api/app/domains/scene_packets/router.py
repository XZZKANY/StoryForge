from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.scene_packets.schemas import ScenePacketCreate, ScenePacketRead
from app.domains.scene_packets.service import ScenePacketInputError, assemble_scene_packet

router = APIRouter(prefix="/api/scene-packets", tags=["场景上下文包"])


@router.post("", response_model=ScenePacketRead, status_code=status.HTTP_201_CREATED)
def create_scene_packet_endpoint(payload: ScenePacketCreate, session: SessionDependency) -> ScenePacketRead:
    """为章节首个场景组装固定槽位 Scene Packet 并持久化。"""

    try:
        return assemble_scene_packet(session, payload)
    except ScenePacketInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
