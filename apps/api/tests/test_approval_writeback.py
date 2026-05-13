from __future__ import annotations

from collections.abc import Generator

import pytest
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.assets.models import Asset, EvidenceLink
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个批准回写测试使用独立内存数据库。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def approval_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备一章待批准正文和一个需要同步状态的草稿资产。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查失真的灯塔信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content="旧版本正文")
        session.add(scene)
        session.flush()
        draft_asset = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="chapter_draft",
            lineage_key="chapter-draft-old-wound",
            name="旧伤草稿",
            status="draft",
            payload={"content": "旧版本正文"},
            version=1,
        )
        session.add(draft_asset)
        session.commit()
        return {
            "book_id": book.id,
            "chapter_id": chapter.id,
            "scene_id": scene.id,
            "draft_asset_id": draft_asset.id,
        }


def test_approval_writeback_creates_version_diff_continuity_and_evidence(
    session_factory: sessionmaker[Session],
    approval_context: dict[str, int],
) -> None:
    """用户批准修复后，回写正文并一次性创建谱系、差异、连续性和证据记录。"""

    from app.domains.books.lineage_service import ChapterWritebackApproval, approve_chapter_writeback

    approved_text = "林岚按住仍在发疼的左臂，克制地完成港口谈判。"
    with session_factory() as session:
        result = approve_chapter_writeback(
            session,
            ChapterWritebackApproval(
                book_id=approval_context["book_id"],
                chapter_id=approval_context["chapter_id"],
                approved_content=approved_text,
                diff_summary="将左臂完好无损修正为左臂仍然受伤，并压低解释性语气。",
                approved_by="测试审批员",
                source_asset_ids=[approval_context["draft_asset_id"]],
            ),
        )

        scene = session.get(Scene, approval_context["scene_id"])
        chapter = session.get(Chapter, approval_context["chapter_id"])
        draft_asset = session.get(Asset, approval_context["draft_asset_id"])
        assets = session.scalars(select(Asset).order_by(Asset.id)).all()
        links = session.scalars(select(EvidenceLink).order_by(EvidenceLink.id)).all()
        records = session.scalars(select(ContinuityRecord).order_by(ContinuityRecord.id)).all()

    assert result.final_asset_id > 0
    assert scene is not None
    assert scene.content == approved_text
    assert scene.status == "approved"
    assert chapter is not None
    assert chapter.status == "approved"
    assert draft_asset is not None
    assert draft_asset.status == "approved"
    assert len(assets) == 3
    final_asset = next(asset for asset in assets if asset.asset_type == "chapter_version")
    diff_asset = next(asset for asset in assets if asset.asset_type == "asset_diff")
    assert final_asset.payload["content"] == approved_text
    assert final_asset.payload["approved_by"] == "测试审批员"
    assert diff_asset.payload["summary"] == "将左臂完好无损修正为左臂仍然受伤，并压低解释性语气。"
    assert diff_asset.payload["final_asset_id"] == final_asset.id
    assert len(links) == 1
    assert links[0].asset_id == final_asset.id
    assert links[0].scene_id == approval_context["scene_id"]
    assert links[0].evidence_type == "approval_writeback"
    assert links[0].source_ref == f"chapter:{approval_context['chapter_id']}:approved"
    assert len(records) == 1
    assert records[0].record_type == "chapter_approval"
    assert records[0].payload["approved_content"] == approved_text
    assert records[0].payload["final_asset_id"] == final_asset.id
    assert records[0].payload["diff_asset_id"] == diff_asset.id


def _assert_approval_writeback_state_clean(
    session: Session,
    approval_context: dict[str, int],
    expected_asset_count: int,
) -> None:
    """确认失败回写没有污染正文、状态和追踪记录。"""

    scene = session.get(Scene, approval_context["scene_id"])
    chapter = session.get(Chapter, approval_context["chapter_id"])
    draft_asset = session.get(Asset, approval_context["draft_asset_id"])
    assets = session.scalars(select(Asset).order_by(Asset.id)).all()
    links = session.scalars(select(EvidenceLink).order_by(EvidenceLink.id)).all()
    records = session.scalars(select(ContinuityRecord).order_by(ContinuityRecord.id)).all()

    assert scene is not None
    assert scene.status == "draft"
    assert scene.content == "旧版本正文"
    assert chapter is not None
    assert chapter.status == "draft"
    assert draft_asset is not None
    assert draft_asset.status == "draft"
    assert len(assets) == expected_asset_count
    assert all(asset.asset_type == "chapter_draft" for asset in assets)
    assert links == []
    assert records == []


def test_approval_writeback_rolls_back_when_source_asset_missing(
    session_factory: sessionmaker[Session],
    approval_context: dict[str, int],
) -> None:
    """来源资产不存在时抛出错误，并且不留下任何部分写入。"""

    from app.domains.books.lineage_service import (
        ChapterWritebackApproval,
        ChapterWritebackError,
        approve_chapter_writeback,
    )

    with session_factory() as session:
        expected_asset_count = len(session.scalars(select(Asset)).all())
        missing_asset_id = approval_context["draft_asset_id"] + 999

        with pytest.raises(ChapterWritebackError):
            approve_chapter_writeback(
                session,
                ChapterWritebackApproval(
                    book_id=approval_context["book_id"],
                    chapter_id=approval_context["chapter_id"],
                    approved_content="不应写入的批准正文",
                    diff_summary="不应写入的差异摘要",
                    approved_by="测试审批员",
                    source_asset_ids=[missing_asset_id],
                ),
            )

        _assert_approval_writeback_state_clean(session, approval_context, expected_asset_count)


def test_approval_writeback_rolls_back_when_source_asset_belongs_to_other_book(
    session_factory: sessionmaker[Session],
    approval_context: dict[str, int],
) -> None:
    """来源资产属于其他作品时抛出错误，并且不污染当前作品与跨作品资产。"""

    from app.domains.books.lineage_service import (
        ChapterWritebackApproval,
        ChapterWritebackError,
        approve_chapter_writeback,
    )

    with session_factory() as session:
        other_book = Book(title="远岸回声", status="draft", premise="另一部作品。")
        session.add(other_book)
        session.flush()
        other_asset = Asset(
            book_id=other_book.id,
            scene_id=None,
            asset_type="chapter_draft",
            lineage_key="other-book-draft",
            name="其他作品草稿",
            status="draft",
            payload={"content": "其他作品正文"},
            version=1,
        )
        session.add(other_asset)
        session.commit()
        expected_asset_count = len(session.scalars(select(Asset)).all())
        other_asset_id = other_asset.id

        with pytest.raises(ChapterWritebackError):
            approve_chapter_writeback(
                session,
                ChapterWritebackApproval(
                    book_id=approval_context["book_id"],
                    chapter_id=approval_context["chapter_id"],
                    approved_content="不应写入的批准正文",
                    diff_summary="不应写入的差异摘要",
                    approved_by="测试审批员",
                    source_asset_ids=[other_asset_id],
                ),
            )

        _assert_approval_writeback_state_clean(session, approval_context, expected_asset_count)
        refreshed_other_asset = session.get(Asset, other_asset_id)
        assert refreshed_other_asset is not None
        assert refreshed_other_asset.status == "draft"
        assert refreshed_other_asset.payload == {"content": "其他作品正文"}
