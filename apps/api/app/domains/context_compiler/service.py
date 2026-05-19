from __future__ import annotations

from hashlib import sha1

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.context_compiler.models import CompiledContextRecord
from app.domains.context_compiler.schemas import (
    CompiledContext,
    ContextBlock,
    ContextBudgetReport,
    ContextCompileRequest,
    DroppedContextBlock,
    InjectedContextBlock,
)

_PRIORITY_WEIGHT = {"required": 0, "high": 1, "medium": 2, "low": 3}
_POSITION_WEIGHT = {"system": 0, "memory": 1, "scene": 2, "evidence": 3, "style": 4, "user": 5}


def compile_context(payload: ContextCompileRequest) -> CompiledContext:
    """按成熟竞品的上下文预算思路，生成可解释、可裁剪、可调试的上下文。"""

    injected: list[InjectedContextBlock] = []
    dropped: list[DroppedContextBlock] = []
    used_tokens = 0
    dropped_tokens = 0

    ordered_blocks = sorted(payload.blocks, key=_selection_key)
    for block in ordered_blocks:
        if block.priority != "required" and block.score < payload.score_threshold:
            dropped.append(_drop(block, "低于 score_threshold，避免弱相关检索污染上下文。"))
            dropped_tokens += block.token_count
            continue

        if used_tokens + block.token_count > payload.token_budget:
            dropped.append(_drop(block, "超过剩余 token 预算，按优先级裁剪。"))
            dropped_tokens += block.token_count
            continue

        used_tokens += block.token_count
        injected.append(
            InjectedContextBlock(
                block_id=block.block_id,
                kind=block.kind,
                title=block.title,
                content=block.content,
                source_ref=block.source_ref,
                token_count=block.token_count,
                injection_position=block.injection_position,
                priority=block.priority,
                score=block.score,
                order=0,
                reason=_inject_reason(block),
                metadata=block.metadata,
            )
        )

    injected = _assign_injection_order(injected)
    compiled_context_id = _context_id(payload, injected)
    budget_report = ContextBudgetReport(
        token_budget=payload.token_budget,
        used_tokens=used_tokens,
        reserved_tokens=sum(block.token_count for block in injected if block.priority == "required"),
        dropped_tokens=dropped_tokens,
        truncated=bool(dropped),
    )
    return CompiledContext(
        compiled_context_id=compiled_context_id,
        novel_id=payload.novel_id,
        chapter_id=payload.chapter_id,
        scene_id=payload.scene_id,
        outline_revision=payload.outline_revision,
        memory_revision=payload.memory_revision,
        timeline_revision=payload.timeline_revision,
        injected_blocks=injected,
        dropped_blocks=dropped,
        budget_report=budget_report,
        debug_summary=_debug_summary(injected, dropped, budget_report),
    )


def _selection_key(block: ContextBlock) -> tuple[int, float, int, str]:
    """先保硬约束，再保高分上下文，最后按较小块优先减少浪费。"""

    return (_PRIORITY_WEIGHT[block.priority], -block.score, block.token_count, block.block_id)


def _assign_injection_order(blocks: list[InjectedContextBlock]) -> list[InjectedContextBlock]:
    """采用 NovelAI/SillyTavern 式插入位置，生成最终上下文顺序。"""

    ordered = sorted(blocks, key=lambda block: (_POSITION_WEIGHT[block.injection_position], block.order, block.block_id))
    return [block.model_copy(update={"order": index}) for index, block in enumerate(ordered, start=1)]


def _inject_reason(block: ContextBlock) -> str:
    if block.priority == "required":
        return "必保留上下文，类似 Story Bible 中不可丢弃的核心事实。"
    if block.kind == "retrieval_chunk":
        return "检索证据达到阈值并且预算允许，作为场景证据注入。"
    if block.kind in {"memory_atom", "timeline_event"}:
        return "版本化记忆或时间线事件与当前场景相关，注入以维持长篇一致性。"
    return "上下文块通过优先级、相关度和预算检查。"


def _drop(block: ContextBlock, reason: str) -> DroppedContextBlock:
    return DroppedContextBlock(
        block_id=block.block_id,
        kind=block.kind,
        title=block.title,
        source_ref=block.source_ref,
        token_count=block.token_count,
        priority=block.priority,
        score=block.score,
        reason=reason,
    )


def _context_id(payload: ContextCompileRequest, injected: list[InjectedContextBlock]) -> str:
    raw = "|".join(
        [
            str(payload.novel_id),
            str(payload.chapter_id),
            str(payload.scene_id),
            str(payload.outline_revision),
            str(payload.memory_revision),
            str(payload.timeline_revision),
            *[block.block_id for block in injected],
        ]
    )
    return f"ctx_{sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def _debug_summary(
    injected: list[InjectedContextBlock],
    dropped: list[DroppedContextBlock],
    budget: ContextBudgetReport,
) -> list[str]:
    return [
        f"已注入 {len(injected)} 个上下文块，使用 {budget.used_tokens}/{budget.token_budget} tokens。",
        f"已丢弃 {len(dropped)} 个上下文块，释放或避免占用 {budget.dropped_tokens} tokens。",
        "上下文顺序由 injection_position 决定，便于后续 Context Inspector 展示。",
    ]


def persist_compiled_context(session: Session, compiled_context: CompiledContext) -> CompiledContextRecord:
    """保存可审计的上下文编译快照，避免 compiled_context_id 只存在于运行时。"""

    existing = get_compiled_context_record(session, compiled_context.compiled_context_id)
    if existing is not None:
        return existing

    record = CompiledContextRecord(
        compiled_context_id=compiled_context.compiled_context_id,
        book_id=compiled_context.novel_id,
        chapter_id=compiled_context.chapter_id,
        scene_id=compiled_context.scene_id,
        token_budget=compiled_context.budget_report.token_budget,
        used_tokens=compiled_context.budget_report.used_tokens,
        dropped_tokens=compiled_context.budget_report.dropped_tokens,
        injected_count=len(compiled_context.injected_blocks),
        dropped_count=len(compiled_context.dropped_blocks),
        block_refs=_compiled_context_block_refs(compiled_context),
        budget_report=compiled_context.budget_report.model_dump(),
        debug_summary=compiled_context.debug_summary,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


def get_compiled_context_record(session: Session, compiled_context_id: str) -> CompiledContextRecord | None:
    """按稳定字符串 ID 读取上下文编译快照。"""

    return session.scalar(
        select(CompiledContextRecord).where(CompiledContextRecord.compiled_context_id == compiled_context_id)
    )


def _compiled_context_block_refs(compiled_context: CompiledContext) -> dict[str, list[dict[str, object]]]:
    return {
        "injected": [
            {
                "block_id": block.block_id,
                "kind": block.kind,
                "source_ref": block.source_ref,
                "token_count": block.token_count,
                "priority": block.priority,
                "order": block.order,
                "reason": block.reason,
            }
            for block in compiled_context.injected_blocks
        ],
        "dropped": [
            {
                "block_id": block.block_id,
                "kind": block.kind,
                "source_ref": block.source_ref,
                "token_count": block.token_count,
                "priority": block.priority,
                "reason": block.reason,
            }
            for block in compiled_context.dropped_blocks
        ],
    }
