from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.context_compiler.service import get_compiled_context_record
from app.domains.ide.schemas import IdeContextBlockRef, IdeContextBudget, IdeContextSnapshot


def get_context_snapshot(session: Session, compiled_context_id: str) -> IdeContextSnapshot | None:
    """按 compiled_context_id 读取 Context Inspector 所需快照。"""

    record = get_compiled_context_record(session, compiled_context_id)
    if record is None:
        return None

    budget_report = record.budget_report or {}
    block_refs = record.block_refs or {}
    return IdeContextSnapshot(
        compiled_context_id=record.compiled_context_id,
        book_id=record.book_id,
        chapter_id=record.chapter_id,
        scene_id=record.scene_id,
        budget=IdeContextBudget(
            token_budget=int(budget_report.get("token_budget", record.token_budget)),
            used_tokens=int(budget_report.get("used_tokens", record.used_tokens)),
            dropped_tokens=int(budget_report.get("dropped_tokens", record.dropped_tokens)),
            truncated=bool(budget_report.get("truncated", record.dropped_count > 0)),
        ),
        injected_blocks=[_context_block_ref(item) for item in block_refs.get("injected", []) if isinstance(item, dict)],
        dropped_blocks=[_context_block_ref(item) for item in block_refs.get("dropped", []) if isinstance(item, dict)],
        debug_summary=[str(item) for item in (record.debug_summary or [])],
    )


def _context_block_ref(item: dict[str, object]) -> IdeContextBlockRef:
    """从持久化 JSON 字典恢复上下文块引用。"""

    order_value = item.get("order")
    return IdeContextBlockRef(
        block_id=str(item.get("block_id", "")),
        kind=str(item.get("kind", "")),
        source_ref=str(item.get("source_ref", "")),
        token_count=int(item.get("token_count", 0)),
        priority=str(item.get("priority", "")),
        reason=str(item.get("reason", "")),
        order=int(order_value) if order_value is not None else None,
    )
