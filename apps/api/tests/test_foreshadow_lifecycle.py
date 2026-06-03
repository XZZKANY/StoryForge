from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter
from app.domains.story_memory.schemas import ForeshadowLifecycleTransition
from app.domains.story_memory.service import (
    ForeshadowLifecycleConflictError,
    ForeshadowLifecycleTransitionError,
    apply_foreshadow_lifecycle_transition,
    list_foreshadow_lifecycle,
)


def _book_with_chapters(session: Session) -> dict[str, int]:
    """准备同一作品的三章，供生命周期转换记录章节证据。"""

    book = Book(title="灯塔伏笔", status="draft", premise="追查失真的灯塔信号。")
    session.add(book)
    session.flush()
    chapters = [
        Chapter(book_id=book.id, ordinal=1, title="埋钩", status="draft", summary="信号第一次失真。"),
        Chapter(book_id=book.id, ordinal=2, title="加压", status="draft", summary="信号影响导航。"),
        Chapter(book_id=book.id, ordinal=3, title="回收", status="draft", summary="信号来自旧航线密钥。"),
    ]
    session.add_all(chapters)
    session.commit()
    return {
        "book_id": book.id,
        "chapter_1_id": chapters[0].id,
        "chapter_2_id": chapters[1].id,
        "chapter_3_id": chapters[2].id,
    }


def test_foreshadow_lifecycle_transitions_from_planted_to_paid_off(session: Session) -> None:
    """伏笔应按 planted -> reinforced -> paid_off 推进，并记录章节、卷、证据和原因。"""

    context = _book_with_chapters(session)

    planted = apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="planted",
            chapter_id=context["chapter_1_id"],
            volume_id=1,
            evidence_refs=["chapter:1#signal"],
            transition_reason="第一章出现每七分钟重复的异常信号。",
        ),
    )
    reinforced = apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="reinforced",
            chapter_id=context["chapter_2_id"],
            volume_id=1,
            evidence_refs=["chapter:2#navigation"],
            transition_reason="第二章确认信号会干扰舰队导航。",
        ),
    )
    paid_off = apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="paid_off",
            chapter_id=context["chapter_3_id"],
            volume_id=1,
            evidence_refs=["chapter:3#beacon-key"],
            transition_reason="第三章揭示信号来自旧航线密钥。",
        ),
    )

    assert planted.state == "planted"
    assert reinforced.state == "reinforced"
    assert paid_off.state == "paid_off"
    assert paid_off.chapter_id == context["chapter_3_id"]
    assert paid_off.volume_id == 1
    assert paid_off.evidence_refs == ["chapter:3#beacon-key"]
    assert paid_off.transition_reason == "第三章揭示信号来自旧航线密钥。"
    assert paid_off.revision == 3
    assert [item.state for item in list_foreshadow_lifecycle(session, context["book_id"], "hook-signal")] == [
        "planted",
        "reinforced",
        "paid_off",
    ]


def test_foreshadow_lifecycle_rejects_illegal_rollback(session: Session) -> None:
    """已经强化的伏笔不能回退到 planted，避免生命周期倒流。"""

    context = _book_with_chapters(session)
    apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="planted",
            chapter_id=context["chapter_1_id"],
            volume_id=1,
            evidence_refs=["chapter:1#signal"],
            transition_reason="埋下异常信号。",
        ),
    )
    apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="reinforced",
            chapter_id=context["chapter_2_id"],
            volume_id=1,
            evidence_refs=["chapter:2#navigation"],
            transition_reason="强化信号影响。",
        ),
    )

    with pytest.raises(ForeshadowLifecycleTransitionError, match="不允许从 reinforced 转换到 planted"):
        apply_foreshadow_lifecycle_transition(
            session,
            ForeshadowLifecycleTransition(
                novel_id=context["book_id"],
                foreshadow_id="hook-signal",
                target_state="planted",
                chapter_id=context["chapter_3_id"],
                volume_id=1,
                evidence_refs=["chapter:3#rollback"],
                transition_reason="错误地试图重新埋钩。",
            ),
        )


def test_foreshadow_lifecycle_rejects_duplicate_paid_off(session: Session) -> None:
    """paid_off 是终态，重复回收必须作为状态冲突拒绝。"""

    context = _book_with_chapters(session)
    for target_state, chapter_key, reason in [
        ("planted", "chapter_1_id", "第一章埋钩。"),
        ("reinforced", "chapter_2_id", "第二章强化。"),
        ("paid_off", "chapter_3_id", "第三章回收。"),
    ]:
        apply_foreshadow_lifecycle_transition(
            session,
            ForeshadowLifecycleTransition(
                novel_id=context["book_id"],
                foreshadow_id="hook-signal",
                target_state=target_state,
                chapter_id=context[chapter_key],
                volume_id=1,
                evidence_refs=[f"{chapter_key}#evidence"],
                transition_reason=reason,
            ),
        )

    with pytest.raises(ForeshadowLifecycleConflictError, match="已经处于 paid_off"):
        apply_foreshadow_lifecycle_transition(
            session,
            ForeshadowLifecycleTransition(
                novel_id=context["book_id"],
                foreshadow_id="hook-signal",
                target_state="paid_off",
                chapter_id=context["chapter_3_id"],
                volume_id=1,
                evidence_refs=["chapter:3#repeat"],
                transition_reason="重复回收同一伏笔。",
            ),
        )


def test_foreshadow_lifecycle_degrades_paid_off_without_evidence(session: Session) -> None:
    """缺少证据的 paid_off 请求应降级为 abandoned，并保留降级原因。"""

    context = _book_with_chapters(session)
    apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="planted",
            chapter_id=context["chapter_1_id"],
            volume_id=1,
            evidence_refs=["chapter:1#signal"],
            transition_reason="第一章埋下异常信号。",
        ),
    )
    apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="reinforced",
            chapter_id=context["chapter_2_id"],
            volume_id=1,
            evidence_refs=["chapter:2#navigation"],
            transition_reason="第二章强化异常信号。",
        ),
    )

    result = apply_foreshadow_lifecycle_transition(
        session,
        ForeshadowLifecycleTransition(
            novel_id=context["book_id"],
            foreshadow_id="hook-signal",
            target_state="paid_off",
            chapter_id=context["chapter_3_id"],
            volume_id=1,
            evidence_refs=[],
            transition_reason="声称已经回收，但没有可追溯证据。",
        ),
    )

    assert result.state == "abandoned"
    assert result.requested_state == "paid_off"
    assert result.degraded is True
    assert result.evidence_refs == []
    assert "缺少证据" in result.transition_reason
