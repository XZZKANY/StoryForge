from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.continuity.edge_constraints import (
    ContinuityConflict,
    ContinuityEdgeCandidate,
    check_edge_constraints,
)
from app.domains.continuity.models import ContinuityEdge


@pytest.fixture()
def book_id(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查失真的灯塔信号。")
        session.add(book)
        session.commit()
        return book.id


def _add_edge(
    session: Session,
    *,
    book_id: int,
    edge_kind: str,
    subject_ref: str,
    predicate: str,
    object_ref: str,
    valid_from_chapter: int = 1,
    valid_to_chapter: int | None = None,
) -> None:
    session.add(
        ContinuityEdge(
            book_id=book_id,
            edge_kind=edge_kind,
            subject_ref=subject_ref,
            predicate=predicate,
            object_ref=object_ref,
            valid_from_chapter=valid_from_chapter,
            valid_to_chapter=valid_to_chapter,
        )
    )
    session.commit()


def test_relationship_cycle_detected(session_factory: sessionmaker[Session], book_id: int) -> None:
    """A 是 B 的父、B 是 C 的父，候选 C 是 A 的父 → 成环被检出。"""

    with session_factory() as session:
        _add_edge(session, book_id=book_id, edge_kind="relationship", subject_ref="character:A", predicate="父", object_ref="character:B")
        _add_edge(session, book_id=book_id, edge_kind="relationship", subject_ref="character:B", predicate="父", object_ref="character:C")
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="relationship", subject_ref="character:C", predicate="父", object_ref="character:A"
            ),
        )
    assert len(conflicts) == 1
    assert conflicts[0].severity == "blocking"
    assert "成环" in conflicts[0].reason


def test_relationship_non_cycle_passes(session_factory: sessionmaker[Session], book_id: int) -> None:
    """无回路的链不误报。"""

    with session_factory() as session:
        _add_edge(session, book_id=book_id, edge_kind="relationship", subject_ref="character:A", predicate="父", object_ref="character:B")
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="relationship", subject_ref="character:B", predicate="父", object_ref="character:C"
            ),
        )
    assert conflicts == []


def test_self_reference_is_cycle(session_factory: sessionmaker[Session], book_id: int) -> None:
    """自指边即最小环。"""

    with session_factory() as session:
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="relationship", subject_ref="character:A", predicate="父", object_ref="character:A"
            ),
        )
    assert len(conflicts) == 1
    assert "自指" in conflicts[0].reason


def test_timeline_order_inversion_detected(session_factory: sessionmaker[Session], book_id: int) -> None:
    """X 早于 Y 已存在，候选 Y 早于 X → 时间线倒错。"""

    with session_factory() as session:
        _add_edge(session, book_id=book_id, edge_kind="timeline_order", subject_ref="event:X", predicate="早于", object_ref="event:Y")
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="timeline_order", subject_ref="event:Y", predicate="早于", object_ref="event:X"
            ),
        )
    assert len(conflicts) == 1
    assert "时间线倒错" in conflicts[0].reason


def test_status_window_conflict_detected(session_factory: sessionmaker[Session], book_id: int) -> None:
    """第 40 章起已死亡，候选第 45 章活动状态 → 时间窗冲突。"""

    with session_factory() as session:
        _add_edge(
            session,
            book_id=book_id,
            edge_kind="status",
            subject_ref="character:林岚",
            predicate="生死",
            object_ref="已死亡",
            valid_from_chapter=40,
            valid_to_chapter=None,
        )
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="status",
                subject_ref="character:林岚",
                predicate="生死",
                object_ref="活动",
                valid_from_chapter=45,
            ),
        )
    assert len(conflicts) == 1
    assert conflicts[0].severity == "high"
    assert "时间窗冲突" in conflicts[0].reason


def test_status_window_disjoint_passes(session_factory: sessionmaker[Session], book_id: int) -> None:
    """窗口不重叠（死亡前的活动状态）不误报。"""

    with session_factory() as session:
        _add_edge(
            session,
            book_id=book_id,
            edge_kind="status",
            subject_ref="character:林岚",
            predicate="生死",
            object_ref="已死亡",
            valid_from_chapter=40,
            valid_to_chapter=None,
        )
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="status",
                subject_ref="character:林岚",
                predicate="生死",
                object_ref="活动",
                valid_from_chapter=10,
                valid_to_chapter=20,
            ),
        )
    assert conflicts == []


def test_empty_book_returns_no_conflicts(session_factory: sessionmaker[Session], book_id: int) -> None:
    """空库 / 无相关边时返回空列表。"""

    with session_factory() as session:
        for kind, subj, pred, obj in [
            ("relationship", "character:A", "父", "character:B"),
            ("timeline_order", "event:X", "早于", "event:Y"),
            ("status", "character:林岚", "生死", "活动"),
        ]:
            conflicts = check_edge_constraints(
                session,
                book_id=book_id,
                candidate=ContinuityEdgeCandidate(edge_kind=kind, subject_ref=subj, predicate=pred, object_ref=obj),
            )
            assert conflicts == []


def test_chapter_ordinal_fills_default_window(session_factory: sessionmaker[Session], book_id: int) -> None:
    """candidate 未显式给窗口时，用 chapter_ordinal 作为 valid_from_chapter。"""

    with session_factory() as session:
        _add_edge(
            session,
            book_id=book_id,
            edge_kind="status",
            subject_ref="character:林岚",
            predicate="生死",
            object_ref="已死亡",
            valid_from_chapter=40,
            valid_to_chapter=None,
        )
        # 候选默认窗口 from=1（开窗 -> 与 40+ 重叠会冲突），传 chapter_ordinal=10 后 from=10，仍与 40+ 不重叠
        conflicts = check_edge_constraints(
            session,
            book_id=book_id,
            candidate=ContinuityEdgeCandidate(
                edge_kind="status",
                subject_ref="character:林岚",
                predicate="生死",
                object_ref="活动",
                valid_to_chapter=20,
            ),
            chapter_ordinal=10,
        )
    assert conflicts == []


def test_continuity_conflict_contract_stable() -> None:
    """ContinuityConflict 字段契约稳定。"""

    conflict = ContinuityConflict(
        conflict_id="continuity_abc123",
        book_id=1,
        edge_kind="relationship",
        subject_ref="character:A",
        object_ref="character:B",
        severity="blocking",
        reason="测试",
        source_refs=["relationship:character:A-父->character:B"],
    )
    assert set(conflict.model_dump().keys()) == {
        "conflict_id",
        "book_id",
        "edge_kind",
        "subject_ref",
        "object_ref",
        "severity",
        "reason",
        "source_refs",
    }
