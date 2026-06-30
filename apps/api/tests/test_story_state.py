from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.continuity.models import ContinuityEdge
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger
from app.domains.story_state.service import (
    StoryStateGroundingError,
    StoryStateInvariantError,
    commit_story_state_changes,
    reproject_story_state,
)


def _book(session: Session) -> Book:
    book = Book(title="故事状态测试", status="draft", premise="验证跨章状态层。")
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def _event_count(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(StoryStateEvent)) or 0)


def test_story_state_commit_appends_event_and_updates_ledger(session: Session) -> None:
    """接地成功的 CHANGES 会写入事件日志并物化当前态。"""

    book = _book(session)

    result = commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚在码头发现黑匣子，确认它是整条线索的开端。",
        changes=[
            {
                "change_type": "foreshadow.setup",
                "entity_kind": "foreshadow",
                "entity_id": "foreshadow:black-box",
                "canonical_name": "黑匣子",
                "surface_forms": ["黑匣子"],
                "payload": {"phase_to": "setup", "deadline_chapter": 8},
            }
        ],
    )
    ledger = session.scalar(select(StoryStateLedger).where(StoryStateLedger.entity_id == "foreshadow:black-box"))

    assert result.ledger_updates == 1
    assert result.events[0].event_id > 0
    assert result.grounding[0].hard == "pass"
    assert ledger is not None
    assert ledger.canonical_name == "黑匣子"
    assert ledger.state["phase"] == "setup"
    assert ledger.last_chapter == 1


def test_story_state_commit_records_semantic_grounding_advisory(session: Session) -> None:
    """语义 grounding 是咨询信号：记录分数与理由，但不阻断确定性通过的提交。"""

    book = _book(session)

    def semantic_grounder(_prose, changes):
        return {
            int(changes[0].seq or 1): {
                "semantic_score": 87,
                "semantic_reason": "正文明确写出林岚守住誓约。",
            }
        }

    result = commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚在旧桥边守住誓约，没有交出密钥。",
        changes=[
            {
                "change_type": "character.status",
                "entity_kind": "character",
                "entity_id": "character:linlan",
                "canonical_name": "林岚",
                "surface_forms": ["林岚", "誓约"],
                "payload": {"status": "林岚守住誓约。"},
            }
        ],
        semantic_grounder=semantic_grounder,
    )
    event = session.scalar(select(StoryStateEvent))
    ledger = session.scalar(select(StoryStateLedger))

    assert result.grounding[0].semantic_status == "advisory"
    assert result.grounding[0].semantic_score == 87
    assert result.grounding[0].semantic_reason == "正文明确写出林岚守住誓约。"
    assert event is not None
    assert event.grounding["semantic_status"] == "advisory"
    assert event.grounding["semantic_score"] == 87
    assert ledger is not None
    assert ledger.state["status"] == "林岚守住誓约。"


def test_story_state_semantic_grounding_failure_does_not_block_commit(session: Session) -> None:
    """语义 grounding 异常只降级为 advisory 失败标记，不回滚已接地的确定性状态。"""

    book = _book(session)

    def semantic_grounder(_prose, _changes):
        raise RuntimeError("judge timeout")

    result = commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚收起密钥。",
        changes=[
            {
                "change_type": "item.transfer",
                "entity_kind": "item",
                "entity_id": "item:key",
                "canonical_name": "密钥",
                "surface_forms": ["密钥"],
                "payload": {"to": "林岚"},
            }
        ],
        semantic_grounder=semantic_grounder,
    )

    assert result.grounding[0].hard == "pass"
    assert result.grounding[0].semantic_status == "advisory"
    assert result.grounding[0].semantic_reason == "semantic_grounding_failed"
    assert _event_count(session) == 1


def test_story_state_grounding_failure_writes_no_event(session: Session) -> None:
    """CHANGES 的 surface form 不在正文里时，整批拒绝且不写事件。"""

    book = _book(session)

    with pytest.raises(StoryStateGroundingError):
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=1,
            prose="林岚只检查了潮湿的墙面。",
            changes=[
                {
                    "change_type": "foreshadow.setup",
                    "entity_kind": "foreshadow",
                    "entity_id": "foreshadow:black-box",
                    "surface_forms": ["黑匣子"],
                    "payload": {"phase_to": "setup"},
                }
            ],
        )

    assert _event_count(session) == 0
    assert session.scalars(select(StoryStateLedger)).all() == []


def test_reproject_story_state_rolls_back_future_chapters(session: Session) -> None:
    """按章 reproject 会删除目标章之后事件，并重建 ledger 当前态。"""

    book = _book(session)
    commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚把密钥交给顾衡前，先贴身保管。",
        changes=[
            {
                "change_type": "item.transfer",
                "entity_kind": "item",
                "entity_id": "item:key",
                "canonical_name": "密钥",
                "surface_forms": ["密钥"],
                "payload": {"to": "林岚"},
            }
        ],
    )
    commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=2,
        prose="顾衡接过密钥，承诺只在夜巡时使用。",
        changes=[
            {
                "change_type": "item.transfer",
                "entity_kind": "item",
                "entity_id": "item:key",
                "canonical_name": "密钥",
                "surface_forms": ["密钥"],
                "payload": {"from": "林岚", "to": "顾衡"},
            }
        ],
    )

    updates = reproject_story_state(session, book_id=book.id, through_chapter=1)
    ledger = session.scalar(select(StoryStateLedger).where(StoryStateLedger.entity_id == "item:key"))
    remaining_events = session.scalars(select(StoryStateEvent).order_by(StoryStateEvent.chapter_index)).all()

    assert updates == 1
    assert [event.chapter_index for event in remaining_events] == [1]
    assert ledger is not None
    assert ledger.state["holder"] == "林岚"
    assert ledger.last_chapter == 1


def test_foreshadow_payoff_without_setup_is_rejected(session: Session) -> None:
    """伏笔未埋先收是确定性硬失败。"""

    book = _book(session)

    with pytest.raises(StoryStateInvariantError):
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=3,
            prose="黑匣子终于给出答案。",
            changes=[
                {
                    "change_type": "foreshadow.payoff",
                    "entity_kind": "foreshadow",
                    "entity_id": "foreshadow:black-box",
                    "surface_forms": ["黑匣子"],
                    "payload": {"phase_to": "payoff"},
                }
            ],
        )

    assert _event_count(session) == 0


def test_secret_knowers_can_only_increase(session: Session) -> None:
    """秘密知情集不能丢失既有知情者。"""

    book = _book(session)
    commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚和顾衡同时听见密室里的真相。",
        changes=[
            {
                "change_type": "secret.reveal",
                "entity_kind": "secret",
                "entity_id": "secret:locked-room",
                "canonical_name": "密室真相",
                "surface_forms": ["真相"],
                "payload": {"knowers": ["林岚", "顾衡"]},
            }
        ],
    )

    with pytest.raises(StoryStateInvariantError):
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=2,
            prose="林岚复述密室真相。",
            changes=[
                {
                    "change_type": "secret.reveal",
                    "entity_kind": "secret",
                    "entity_id": "secret:locked-room",
                    "canonical_name": "密室真相",
                    "surface_forms": ["密室真相"],
                    "payload": {"knowers": ["林岚"]},
                }
            ],
        )
    ledger = session.scalar(select(StoryStateLedger).where(StoryStateLedger.entity_id == "secret:locked-room"))

    assert _event_count(session) == 1
    assert ledger is not None
    assert ledger.state["knowers"] == ["林岚", "顾衡"]


def test_location_move_requires_matching_previous_location(session: Session) -> None:
    """位置流转的 from 必须等于上一态，避免跨章瞬移。"""

    book = _book(session)
    commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚抵达雾港码头。",
        changes=[
            {
                "change_type": "location.move",
                "entity_kind": "location",
                "entity_id": "character:linlan",
                "canonical_name": "林岚",
                "surface_forms": ["林岚"],
                "payload": {"to": "雾港码头"},
            }
        ],
    )

    with pytest.raises(StoryStateInvariantError):
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=2,
            prose="林岚走上旧桥。",
            changes=[
                {
                    "change_type": "location.move",
                    "entity_kind": "location",
                    "entity_id": "character:linlan",
                    "canonical_name": "林岚",
                    "surface_forms": ["林岚"],
                    "payload": {"from": "地下室", "to": "旧桥"},
                }
            ],
        )

    ledger = session.scalar(select(StoryStateLedger).where(StoryStateLedger.entity_id == "character:linlan"))
    assert _event_count(session) == 1
    assert ledger is not None
    assert ledger.state["location"] == "雾港码头"


def test_story_state_edge_change_writes_continuity_edge(session: Session) -> None:
    """relationship / timeline / status 类 CHANGES 应分流到 continuity_edges。"""

    book = _book(session)

    result = commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚与顾衡在钟楼下结成盟友。",
        changes=[
            {
                "change_type": "relationship.update",
                "entity_kind": "relationship",
                "entity_id": "character:linlan",
                "object_id": "character:guheng",
                "canonical_name": "林岚",
                "surface_forms": ["林岚", "顾衡", "盟友"],
                "payload": {"predicate": "盟友"},
            }
        ],
    )
    edge = session.scalar(select(ContinuityEdge))

    assert result.edge_count == 1
    assert result.ledger_updates == 0
    assert _event_count(session) == 1
    assert edge is not None
    assert edge.edge_kind == "relationship"
    assert edge.subject_ref == "character:linlan"
    assert edge.predicate == "盟友"
    assert edge.object_ref == "character:guheng"
    assert edge.payload["source"] == "story_state"
    assert session.scalars(select(StoryStateLedger)).all() == []


def test_story_state_edge_conflict_rolls_back_whole_commit(session: Session) -> None:
    """edge 冲突应拒绝整批提交，不能只写 event 或 ledger。"""

    book = _book(session)
    commit_story_state_changes(
        session,
        book_id=book.id,
        chapter_index=1,
        prose="林岚是顾衡的师父。",
        changes=[
            {
                "change_type": "relationship.update",
                "entity_kind": "relationship",
                "entity_id": "character:linlan",
                "object_id": "character:guheng",
                "surface_forms": ["林岚", "顾衡"],
                "payload": {"predicate": "师父"},
            }
        ],
    )

    with pytest.raises(StoryStateInvariantError, match="连续性边冲突"):
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=2,
            prose="顾衡反称自己是林岚的师父。",
            changes=[
                {
                    "change_type": "relationship.update",
                    "entity_kind": "relationship",
                    "entity_id": "character:guheng",
                    "object_id": "character:linlan",
                    "surface_forms": ["顾衡", "林岚"],
                    "payload": {"predicate": "师父"},
                }
            ],
        )

    assert _event_count(session) == 1
    assert len(session.scalars(select(ContinuityEdge)).all()) == 1


def test_reproject_story_state_rebuilds_story_state_edges(session: Session) -> None:
    """reproject 应同步删除目标章之后由 story_state 产生的 continuity_edges。"""

    book = _book(session)
    for chapter_index, subject, obj in [
        (1, "event:first", "event:second"),
        (2, "event:second", "event:third"),
    ]:
        commit_story_state_changes(
            session,
            book_id=book.id,
            chapter_index=chapter_index,
            prose=f"{subject} 早于 {obj}。",
            changes=[
                {
                    "change_type": "timeline.before",
                    "entity_kind": "timeline_order",
                    "entity_id": subject,
                    "object_id": obj,
                    "surface_forms": [subject, obj],
                    "payload": {"predicate": "早于"},
                }
            ],
        )

    reproject_story_state(session, book_id=book.id, through_chapter=1)
    edges = session.scalars(select(ContinuityEdge).order_by(ContinuityEdge.valid_from_chapter)).all()

    assert [edge.subject_ref for edge in edges] == ["event:first"]
    assert [edge.object_ref for edge in edges] == ["event:second"]
