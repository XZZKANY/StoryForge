from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.story_memory.models import MemoryAtomRecord
from app.domains.story_memory.schemas import AgentProposal, ArbitrationDecision, MemoryAtom
from app.domains.story_memory.service import (
    apply_arbitration_decision,
    create_memory_atom,
    get_active_memory_atoms,
    list_memory_atoms,
)


def test_memory_atom_record_table_uses_existing_integer_book_id(session: Session) -> None:
    """memory_atoms 表必须使用现有 int 主键体系，不得凭空假设 UUID。"""

    columns = inspect(session.bind).get_columns("memory_atoms")
    column_types = {column["name"]: column["type"].__class__.__name__.lower() for column in columns}

    assert column_types["id"] == "integer"
    assert column_types["book_id"] == "integer"
    assert "entity_id" in column_types
    assert "value" in column_types


def test_memory_atom_record_can_persist_minimum_required_fields(session: Session) -> None:
    """最小持久化应覆盖总计划 11.5 要求的字段。"""

    book = Book(title="记忆持久化", status="draft", premise="验证 memory atoms。")
    session.add(book)
    session.flush()
    record = MemoryAtomRecord(
        book_id=book.id,
        entity_type="character",
        entity_id="linlan",
        fact_type="status",
        value="左臂有旧伤",
        valid_from_chapter=3,
        valid_to_chapter=None,
        immutable=True,
        confidence=0.95,
        revision=1,
        source_ref="chapter:3",
    )
    session.add(record)
    session.commit()

    saved = session.get(MemoryAtomRecord, record.id)

    assert saved is not None
    assert saved.book_id == book.id
    assert isinstance(saved.book_id, int)
    assert saved.entity_id == "linlan"
    assert saved.immutable is True
    assert saved.confidence == 0.95


def test_memory_atom_crud_returns_contract_and_filters_active_chapter(session: Session) -> None:
    """持久化服务应返回契约对象，并按章节有效区间查询事实。"""

    book = Book(title="记忆查询", status="draft", premise="验证章节有效事实。")
    session.add(book)
    session.commit()
    create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-left-arm",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="左臂完好",
            source_ref="chapter:1",
            valid_from_chapter=1,
            valid_to_chapter=3,
        ),
    )
    current_atom = create_memory_atom(
        session,
        MemoryAtom(
            memory_id="draft-left-arm-injured",
            novel_id=book.id,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="左臂有旧伤",
            source_ref="chapter:4",
            valid_from_chapter=4,
            immutable=True,
            confidence=0.9,
        ),
    )

    all_atoms = list_memory_atoms(session, book_id=book.id, entity_id="linlan")
    active_atoms = get_active_memory_atoms(session, book_id=book.id, chapter_id=5, entity_id="linlan")

    assert len(all_atoms) == 2
    assert current_atom.memory_id.startswith("memory:")
    assert [atom.value for atom in active_atoms] == ["左臂有旧伤"]
    assert active_atoms[0].novel_id == book.id
    assert active_atoms[0].immutable is True


def test_auto_merge_arbitration_decision_writes_memory_atom(session: Session) -> None:
    """最小仲裁闭环只在 auto_merge 时写入 memory_atoms。"""

    book = Book(title="仲裁写入", status="draft", premise="验证自动合并。")
    session.add(book)
    session.commit()
    proposal = AgentProposal(
        proposal_id="proposal-memory-1",
        run_id="run-1",
        agent_name="memory_agent",
        target_type="memory",
        target_id="linlan",
        target_revision=1,
        operation="create",
        diff={
            "book_id": book.id,
            "entity_type": "character",
            "entity_id": "linlan",
            "fact_type": "status",
            "value": "左臂有旧伤",
            "source_ref": "model_run:1",
            "valid_from_chapter": 4,
            "confidence": 0.88,
        },
        confidence=0.88,
    )
    decision = ArbitrationDecision(proposal_id=proposal.proposal_id, decision="auto_merge", reason="无阻塞冲突。")

    atom = apply_arbitration_decision(session, proposal, decision)

    assert atom is not None
    assert atom.value == "左臂有旧伤"
    assert atom.novel_id == book.id
    assert get_active_memory_atoms(session, book_id=book.id, chapter_id=5, entity_id="linlan")[0].value == "左臂有旧伤"


def test_needs_human_arbitration_decision_does_not_write_memory_atom(session: Session) -> None:
    """需要人工确认的提案不得绕过真相源直接写入。"""

    book = Book(title="仲裁阻断", status="draft", premise="验证人工阻断。")
    session.add(book)
    session.commit()
    proposal = AgentProposal(
        proposal_id="proposal-memory-2",
        run_id="run-1",
        agent_name="memory_agent",
        target_type="memory",
        target_id="linlan",
        target_revision=1,
        operation="create",
        diff={
            "book_id": book.id,
            "entity_type": "character",
            "entity_id": "linlan",
            "fact_type": "status",
            "value": "公开身份是舰队指挥官",
            "source_ref": "model_run:2",
        },
        severity="high",
    )
    decision = ArbitrationDecision(
        proposal_id=proposal.proposal_id,
        decision="needs_human",
        reason="存在高风险事实冲突。",
        blocked_by_conflict_ids=["conflict-1"],
    )

    atom = apply_arbitration_decision(session, proposal, decision)

    assert atom is None
    assert list_memory_atoms(session, book_id=book.id) == []
