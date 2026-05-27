from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.blueprints.models import BookBlueprint
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord
from app.domains.retrieval.schemas import RetrievalHitRead, RetrievalSearchCreate
from app.domains.retrieval.service import search_retrieval
from app.domains.scene_packets.budget import build_packet, estimate_tokens
from app.domains.scene_packets.retrieval_bridge import attach_compiled_context, build_retrieval_query
from app.domains.scene_packets.schemas import BudgetStatistics, EvidenceLinkRead, ScenePacketCreate
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import recall_scene_memory_atoms

PACING_DIRECTIVES: dict[str, dict[str, str]] = {
    "setup": {
        "label": "铺垫",
        "instruction": "建立人物处境、核心问题和关键信息，避免过早兑现重大转折。",
    },
    "rising": {
        "label": "上升",
        "instruction": "持续升级阻力和代价，让每个选择都推动冲突向更高压力发展。",
    },
    "climax": {
        "label": "高潮",
        "instruction": "集中呈现关键对抗、真相揭示和不可逆选择，减少旁支铺陈。",
    },
    "falling": {
        "label": "回落",
        "instruction": "处理高潮后的直接后果，收束紧张情绪并为结局整理因果。",
    },
    "resolution": {
        "label": "结局",
        "instruction": "兑现主要承诺，完成情感落点，并保留必要的余韵。",
    },
}


@dataclass(frozen=True)
class SceneContextAssembly:
    """Scene Packet 上下文装配结果，隔离检索、预算和 compiled context 细节。"""

    packet: dict[str, object]
    budget_statistics: BudgetStatistics
    evidence_links: list[EvidenceLinkRead]
    retrieval_hits: list[RetrievalHitRead]


def assemble_scene_context(
    *,
    session: Session,
    payload: ScenePacketCreate,
    chapter: Chapter,
    scene: Scene,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    evidence_links: list[EvidenceLinkRead],
) -> SceneContextAssembly:
    """组装 Scene Packet 上下文，保持服务层只处理实体定位和持久化。"""

    scoped_evidence_links = list(evidence_links)
    retrieval_hits, payload_with_retrieval = _resolve_retrieval_context(
        session=session,
        payload=payload,
        chapter=chapter,
        assets=assets,
        continuity_records=continuity_records,
    )
    scoped_evidence_links.extend(retrieval_evidence_links(retrieval_hits))
    memory_atoms = recall_scene_memory_atoms(
        session,
        book_id=payload.book_id,
        chapter=chapter,
        assets=assets,
        continuity_records=continuity_records,
    )
    packet, budget_statistics = build_packet(
        payload_with_retrieval,
        chapter,
        assets,
        continuity_records,
        scoped_evidence_links,
    )
    packet["memory_context"] = memory_context_payload(memory_atoms)
    pacing_directive = pacing_directive_payload(session, chapter)
    if pacing_directive is not None:
        packet["pacing_directive"] = pacing_directive
    if retrieval_hits:
        packet["检索命中"] = [hit.model_dump() for hit in retrieval_hits]
    attach_compiled_context(
        session,
        packet,
        payload_with_retrieval,
        chapter,
        scene,
        assets,
        continuity_records,
        retrieval_hits,
        memory_atoms,
    )
    return SceneContextAssembly(
        packet=packet,
        budget_statistics=budget_statistics,
        evidence_links=scoped_evidence_links,
        retrieval_hits=retrieval_hits,
    )


def memory_context_payload(memory_atoms: list[MemoryAtom]) -> list[dict[str, object]]:
    """输出给 Scene Packet 的长效记忆上下文，保留来源和置信度。"""

    return [atom.model_dump() for atom in memory_atoms]


def pacing_directive_payload(session: Session, chapter: Chapter) -> dict[str, str] | None:
    """从章节关联 Blueprint metadata 解析节奏标签，输出稳定写作指令。"""

    if chapter.blueprint_id is None:
        return None
    blueprint = session.get(BookBlueprint, chapter.blueprint_id)
    if blueprint is None or blueprint.book_id != chapter.book_id:
        return None
    tag = resolve_pacing_tag((blueprint.metadata_ or {}).get("pacing_tag"), chapter.ordinal)
    if tag is None:
        return None
    return {"tag": tag, **PACING_DIRECTIVES[tag]}


def resolve_pacing_tag(raw_value: object, chapter_ordinal: int) -> str | None:
    """支持全局字符串、章节序号映射和按章节顺序排列的 pacing_tag。"""

    candidate: object | None = None
    if isinstance(raw_value, str):
        candidate = raw_value
    elif isinstance(raw_value, dict):
        candidate = raw_value.get(str(chapter_ordinal)) or raw_value.get(chapter_ordinal)
    elif isinstance(raw_value, list) and 0 < chapter_ordinal <= len(raw_value):
        candidate = raw_value[chapter_ordinal - 1]
    if not isinstance(candidate, str):
        return None
    normalized = candidate.strip().lower()
    return normalized if normalized in PACING_DIRECTIVES else None


def retrieval_evidence_links(retrieval_hits: list[RetrievalHitRead]) -> list[EvidenceLinkRead]:
    """把检索命中转换为 Scene Packet 证据链接。"""

    return [
        EvidenceLinkRead(
            asset_id=0,
            evidence_type="retrieval_hit",
            source_ref=hit.source_ref,
            rationale=f"检索命中 #{hit.rank}：{hit.title}",
            score=hit.score,
            rank=hit.rank,
            source_id=hit.source_id,
            chunk_id=hit.chunk_id,
            score_source=hit.score_source,
            keyword_score=hit.keyword_score,
            embedding_score=hit.embedding_score,
            rerank_score=hit.rerank_score,
            rerank_provider=hit.rerank_provider,
            rerank_model=hit.rerank_model,
            context_tokens=estimate_tokens(hit.excerpt),
        )
        for hit in retrieval_hits
    ]


def _resolve_retrieval_context(
    *,
    session: Session,
    payload: ScenePacketCreate,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
) -> tuple[list[RetrievalHitRead], ScenePacketCreate]:
    """缺少手工检索片段时执行检索，并返回带片段的 payload 副本。"""

    if payload.retrieval_snippets:
        return [], payload

    retrieval_query = build_retrieval_query(payload, chapter, assets, continuity_records)
    retrieval_hits = search_retrieval(
        session,
        RetrievalSearchCreate(
            query=retrieval_query,
            book_id=payload.book_id,
            limit=3,
        ),
    )
    payload_with_retrieval = payload.model_copy(update={"retrieval_snippets": [hit.excerpt for hit in retrieval_hits]})
    return retrieval_hits, payload_with_retrieval
