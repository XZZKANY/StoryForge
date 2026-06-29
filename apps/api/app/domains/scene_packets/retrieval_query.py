from __future__ import annotations

from app.domains.assets.models import Asset
from app.domains.books.models import Chapter
from app.domains.continuity.models import ContinuityRecord
from app.domains.scene_packets.budget import collect_payload_values, continuity_constraints
from app.domains.scene_packets.schemas import ScenePacketCreate


def build_retrieval_query(
    payload: ScenePacketCreate,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
) -> str:
    """组合场景目标、用户意图、章节摘要和硬约束，生成更稳定的检索查询。"""

    include_facts = collect_payload_values(assets, "必须包含事实") + continuity_constraints(continuity_records)
    segments = [
        payload.scene_goal,
        payload.user_intent,
        chapter.title,
        chapter.summary or "",
        *[str(value) for value in include_facts],
    ]
    normalized = [segment.strip() for segment in segments if str(segment).strip()]
    return " ".join(normalized)
