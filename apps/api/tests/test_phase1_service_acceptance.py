from __future__ import annotations

from collections.abc import Generator
from io import BytesIO
from zipfile import ZipFile

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.domains.assets.schemas import AssetCreate
from app.domains.assets.service import create_asset
from app.domains.books.lineage_service import ChapterWritebackApproval, approve_chapter_writeback
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.schemas import ChapterApprovalCreate
from app.domains.continuity.service import approve_chapter
from app.domains.exports.service import build_epub_export, build_markdown_export
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch
from app.domains.scene_packets.schemas import ScenePacketCreate
from app.domains.scene_packets.service import assemble_scene_packet

import pytest


@pytest.fixture()
def session() -> Generator[Session, None, None]:
    """使用 SQLite 内存库验证 Phase 1 服务闭环。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with factory() as db_session:
        yield db_session
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_phase1_service_closed_loop_auto_inherits_to_next_chapter(session: Session) -> None:
    """第一阶段服务闭环可在本地直接跑通，且下一章自动继承批准后的连续性。"""

    book = Book(title="灯塔闭环", status="draft", premise="林岚追查失真的灯塔信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary="林岚抵达灯塔港。")
    next_chapter = Chapter(book_id=book.id, ordinal=2, title="余波", status="draft", summary="舰队离开灯塔港。")
    session.add_all([chapter, next_chapter])
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="planned", content=None)
    next_scene = Scene(chapter_id=next_chapter.id, ordinal=1, title="远航复盘", status="planned", content=None)
    session.add_all([scene, next_scene])
    session.commit()

    character = create_asset(
        session,
        AssetCreate(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="character",
            name="林岚",
            status="active",
            payload={"关系": "信任副官", "必须包含事实": ["左臂受伤"]},
        ),
    )
    style = create_asset(
        session,
        AssetCreate(
            book_id=book.id,
            scene_id=None,
            asset_type="style_rule",
            name="克制文风",
            status="active",
            payload={"规则": "保持克制", "必须规避事实": ["作者直接解释"]},
        ),
    )

    approve_chapter(
        session,
        ChapterApprovalCreate(
            chapter_id=chapter.id,
            previous_chapter_summary="林岚发现灯塔信号每七分钟重复。",
            character_state_changes={"林岚": "左臂受伤但继续谈判"},
            foreshadowing_changes={"失真的灯塔信号": "仍未回收"},
            style_drift="保持克制，避免解释性旁白。",
            next_chapter_constraints=["林岚必须隐藏伤势", "灯塔信号仍需保留"],
        ),
    )

    first_packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=chapter.id,
            scene_goal="林岚在港口谈判中争取维修窗口。",
            active_asset_ids=[character.id, style.id],
            token_budget=240,
            user_intent="验证第一阶段闭环状态继承。",
            retrieval_snippets=["灯塔信号每七分钟重复一次。"],
        ),
    )
    assert "左臂受伤" in first_packet.packet["必须包含事实"]
    assert "林岚必须隐藏伤势" in first_packet.packet["必须包含事实"]

    draft_content = "林岚举起左臂，众人确认左臂完好无损。作者直接解释她已摆脱旧伤。"
    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=first_packet.scene_id,
            scene_packet_id=first_packet.id,
            content=draft_content,
            required_facts=first_packet.packet["必须包含事实"],
            style_rules=[rule["rule"] for rule in first_packet.packet["风格规则"]],
            evidence_links=[link.model_dump() for link in first_packet.evidence_links],
        ),
    )
    assert {issue.issue_type for issue in issues} == {"setting_conflict", "style_drift"}

    setting_issue = next(issue for issue in issues if issue.issue_type == "setting_conflict")
    patch = create_repair_patch(session, RepairPatchCreate(issue_id=setting_issue.id, content=draft_content))
    assert patch.patch["target_span"] == "左臂完好无损"
    assert patch.patch["replacement_text"] == "左臂仍然受伤"

    approved_content = draft_content.replace(patch.patch["target_span"], patch.patch["replacement_text"]).replace(
        "作者直接解释她已摆脱旧伤。",
        "她把所有解释压回沉默里。",
    )
    writeback = approve_chapter_writeback(
        session,
        ChapterWritebackApproval(
            book_id=book.id,
            chapter_id=chapter.id,
            approved_content=approved_content,
            diff_summary="采纳 Repair patch 并移除解释性旁白。",
            approved_by="Phase 1 服务验收",
            source_asset_ids=[character.id],
        ),
    )
    assert writeback.chapter_id == chapter.id

    next_packet = assemble_scene_packet(
        session,
        ScenePacketCreate(
            book_id=book.id,
            chapter_id=next_chapter.id,
            scene_goal="下一章复盘灯塔信号。",
            active_asset_ids=[style.id],
            token_budget=240,
            user_intent="验证批准后的下一章自动继承。",
            retrieval_snippets=["舰队开始复盘港口谈判。"],
        ),
    )
    assert "林岚必须隐藏伤势" in next_packet.packet["必须包含事实"]
    assert "灯塔信号仍需保留" in next_packet.packet["必须包含事实"]
    assert "林岚抵达灯塔港。" in next_packet.packet["上一章摘要"]

    markdown = build_markdown_export(session, book.id)
    assert "# 灯塔闭环" in markdown
    assert approved_content in markdown

    epub_bytes = build_epub_export(session, book.id)
    with ZipFile(BytesIO(epub_bytes)) as epub:
        content = epub.read("OEBPS/content.xhtml").decode("utf-8")
    assert "灯塔闭环" in content
    assert approved_content in content
