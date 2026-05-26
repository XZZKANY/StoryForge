from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.books.models import Chapter, Scene
from app.domains.context_compiler.schemas import ContextBlock, ContextCompileRequest
from app.domains.context_compiler.service import compile_context, persist_compiled_context
from app.domains.continuity.models import ContinuityRecord
from app.domains.retrieval.schemas import RetrievalHitRead
from app.domains.scene_packets.budget import collect_payload_values, continuity_constraints, estimate_tokens
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


def attach_compiled_context(
    session: Session,
    packet: dict[str, object],
    payload: ScenePacketCreate,
    chapter: Chapter,
    scene: Scene,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    retrieval_hits: list[RetrievalHitRead],
) -> None:
    """把 Scene Packet 现有槽位转换为可解释的 CompiledContext 调试字段。"""

    blocks = build_context_blocks(payload, chapter, assets, continuity_records, retrieval_hits)
    compiled_context = compile_context(
        ContextCompileRequest(
            novel_id=payload.book_id,
            chapter_id=payload.chapter_id,
            scene_id=scene.id,
            token_budget=payload.token_budget,
            blocks=blocks,
            score_threshold=0.25,
        )
    )
    persist_compiled_context(session, compiled_context, commit=False)
    packet["compiled_context_id"] = compiled_context.compiled_context_id
    packet["上下文注入"] = [block.model_dump() for block in compiled_context.injected_blocks]
    packet["上下文裁剪"] = [block.model_dump() for block in compiled_context.dropped_blocks]
    packet["上下文预算"] = compiled_context.budget_report.model_dump()
    packet["上下文调试"] = compiled_context.debug_summary


def build_context_blocks(
    payload: ScenePacketCreate,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    retrieval_hits: list[RetrievalHitRead],
) -> list[ContextBlock]:
    """按优先级生成带分数和注入位置的上下文块。"""

    blocks = [
        ContextBlock(
            block_id="scene-goal",
            kind="scene_goal",
            title="场景目标",
            content=payload.scene_goal,
            source_ref=f"chapter:{chapter.id}",
            token_count=estimate_tokens(payload.scene_goal),
            priority="required",
            injection_position="scene",
        )
    ]
    if payload.user_intent:
        blocks.append(
            ContextBlock(
                block_id="user-intent",
                kind="user_instruction",
                title="用户意图",
                content=payload.user_intent,
                source_ref="request:user_intent",
                token_count=estimate_tokens(payload.user_intent),
                priority="high",
                injection_position="user",
            )
        )
    if chapter.summary:
        blocks.append(
            ContextBlock(
                block_id="chapter-summary",
                kind="timeline_event",
                title="章节摘要",
                content=chapter.summary,
                source_ref=f"chapter:{chapter.id}:summary",
                token_count=estimate_tokens(chapter.summary),
                priority="high",
                injection_position="scene",
            )
        )
    blocks.extend(asset_context_blocks(assets))
    blocks.extend(continuity_context_blocks(continuity_records))
    blocks.extend(retrieval_context_blocks(payload, retrieval_hits))
    return blocks


def retrieval_context_blocks(payload: ScenePacketCreate, retrieval_hits: list[RetrievalHitRead]) -> list[ContextBlock]:
    """检索命中和手工片段统一转为 evidence 上下文块。"""

    if retrieval_hits:
        return [
            ContextBlock(
                block_id=f"retrieval:{hit.source_id}:{hit.chunk_id}",
                kind="retrieval_chunk",
                title=hit.title,
                content=hit.excerpt,
                source_ref=hit.source_ref,
                token_count=estimate_tokens(hit.excerpt),
                priority="medium",
                injection_position="evidence",
                score=hit.score,
                metadata=retrieval_hit_metadata(hit),
            )
            for hit in retrieval_hits
        ]
    return [
        ContextBlock(
            block_id=f"manual-retrieval:{index}",
            kind="retrieval_chunk",
            title=f"手工检索片段 {index}",
            content=snippet,
            source_ref=f"request:retrieval_snippets:{index}",
            token_count=estimate_tokens(snippet),
            priority="medium",
            injection_position="evidence",
            score=0.75,
        )
        for index, snippet in enumerate(payload.retrieval_snippets, start=1)
    ]


def retrieval_hit_metadata(hit: RetrievalHitRead) -> dict[str, str | int | float | bool]:
    """只写入已存在的检索分数字段，避免空 rerank 字段污染上下文块。"""

    metadata: dict[str, str | int | float | bool] = {
        "source_id": hit.source_id,
        "chunk_id": hit.chunk_id,
        "rank": hit.rank,
        "score_source": hit.score_source,
        "keyword_score": hit.keyword_score,
        "embedding_score": hit.embedding_score,
        "context_tokens": estimate_tokens(hit.excerpt),
    }
    if hit.rerank_score is not None:
        metadata["rerank_score"] = hit.rerank_score
    if hit.rerank_provider is not None:
        metadata["rerank_provider"] = hit.rerank_provider
    if hit.rerank_model is not None:
        metadata["rerank_model"] = hit.rerank_model
    return metadata


def asset_context_blocks(assets: list[Asset]) -> list[ContextBlock]:
    """把作品资产转换为记忆、风格或证据上下文块。"""

    blocks: list[ContextBlock] = []
    for asset in assets:
        if asset.asset_type == "style_rule":
            blocks.append(
                ContextBlock(
                    block_id=f"asset:{asset.id}",
                    kind="style_rule",
                    title=asset.name,
                    content=str(asset.payload.get("规则", asset.payload)),
                    source_ref=f"asset:{asset.id}",
                    token_count=estimate_tokens(asset.payload),
                    priority="low",
                    injection_position="style",
                    score=0.8,
                )
            )
            continue
        priority = "required" if asset.payload.get("不可变") is True else "high"
        blocks.append(
            ContextBlock(
                block_id=f"asset:{asset.id}",
                kind="memory_atom",
                title=asset.name,
                content=str(asset.payload),
                source_ref=f"asset:{asset.id}",
                token_count=estimate_tokens(asset.payload),
                priority=priority,
                injection_position="memory",
                score=0.85,
            )
        )
    return blocks


def continuity_context_blocks(records: list[ContinuityRecord]) -> list[ContextBlock]:
    """连续性记录作为时间线或硬约束注入，避免下一章继承断裂。"""

    blocks: list[ContextBlock] = []
    for record in records:
        raw_value = record.payload.get("value")
        if raw_value is None:
            continue
        content = str(raw_value)
        is_required = record.record_type == "next_chapter_constraints"
        blocks.append(
            ContextBlock(
                block_id=f"continuity:{record.id}",
                kind="immutable_fact" if is_required else "timeline_event",
                title=record.record_type,
                content=content,
                source_ref=f"continuity:{record.id}",
                token_count=estimate_tokens(content),
                priority="required" if is_required else "high",
                injection_position="memory" if is_required else "scene",
                score=0.9,
            )
        )
    return blocks
