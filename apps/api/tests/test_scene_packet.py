from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.assets.models import Asset, EvidenceLink
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个测试使用独立内存数据库，确保连续性状态可重复验证。"""

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
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖数据库依赖，复用资产 API 的本地 TestClient 模式。"""

    def override_get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def story_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备作品、章节、场景、资产和证据链接作为上下文包输入。"""

    with session_factory() as session:
        book = Book(title="星海纪元", status="draft", premise="远航舰队寻找新家园。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=2, title="暗潮", status="draft", summary="舰队抵达灯塔港。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="planned", content=None)
        session.add(scene)
        session.flush()
        other_chapter = Chapter(book_id=book.id, ordinal=3, title="余波", status="draft", summary="舰队离开灯塔港。")
        session.add(other_chapter)
        session.flush()
        other_scene = Scene(chapter_id=other_chapter.id, ordinal=1, title="远航复盘", status="planned", content=None)
        session.add(other_scene)
        session.flush()
        character = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="character",
            lineage_key="char-linlan",
            name="林岚",
            status="active",
            payload={"状态": "隐瞒伤势", "关系": "信任副官", "必须包含事实": ["左臂受伤"]},
            version=1,
        )
        style = Asset(
            book_id=book.id,
            scene_id=None,
            asset_type="style_rule",
            lineage_key="style-tone",
            name="叙事语气",
            status="active",
            payload={"规则": "保持克制而具画面感", "必须规避事实": ["不要直接解释设定"]},
            version=1,
        )
        foreshadowing = Asset(
            book_id=book.id,
            scene_id=None,
            asset_type="foreshadowing",
            lineage_key="hook-beacon",
            name="失真的灯塔信号",
            status="active",
            payload={"状态": "未回收", "线索": "信号每七分钟重复一次"},
            version=1,
        )
        session.add_all([character, style, foreshadowing])
        session.flush()
        session.add(
            EvidenceLink(
                asset_id=character.id,
                scene_id=scene.id,
                evidence_type="asset_state",
                source_ref="asset://character/linlan#v1",
                rationale="角色状态来自资产中心。",
            )
        )
        session.add_all(
            [
                EvidenceLink(
                    asset_id=style.id,
                    scene_id=other_scene.id,
                    evidence_type="asset_state",
                    source_ref="asset://style/other-scene#v1",
                    rationale="其他场景的风格证据不应进入当前上下文包。",
                ),
                EvidenceLink(
                    asset_id=foreshadowing.id,
                    scene_id=None,
                    evidence_type="asset_state",
                    source_ref="asset://foreshadowing/global#v1",
                    rationale="全局伏笔证据可被当前上下文包复用。",
                ),
            ]
        )
        session.commit()
        return {
            "book_id": book.id,
            "chapter_id": chapter.id,
            "scene_id": scene.id,
            "other_chapter_id": other_chapter.id,
            "other_scene_id": other_scene.id,
            "character_id": character.id,
            "style_id": style.id,
            "foreshadowing_id": foreshadowing.id,
        }


def approve_chapter(client: TestClient, chapter_id: int) -> dict:
    response = client.post(
        "/api/continuity/chapter-approval",
        json={
            "chapter_id": chapter_id,
            "previous_chapter_summary": "上一章中林岚发现灯塔信号异常。",
            "character_state_changes": {"林岚": "左臂受伤但继续谈判"},
            "foreshadowing_changes": {"失真的灯塔信号": "仍未回收"},
            "style_drift": "本章对白更紧张，仍保持克制。",
            "next_chapter_constraints": ["林岚必须隐藏伤势", "灯塔信号仍需保留"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_chapter_approval_records_five_continuity_types(
    client: TestClient,
    session_factory: sessionmaker[Session],
    story_context: dict[str, int],
) -> None:
    """章节批准后写入五类连续性记录，供下一章继承。"""

    result = approve_chapter(client, story_context["chapter_id"])

    assert result["chapter_id"] == story_context["chapter_id"]
    assert result["record_count"] == 5
    assert {record["record_type"] for record in result["records"]} == {
        "previous_chapter_summary",
        "character_state_changes",
        "foreshadowing_changes",
        "style_drift",
        "next_chapter_constraints",
    }
    with session_factory() as session:
        records = session.scalars(select(ContinuityRecord).order_by(ContinuityRecord.id)).all()
    assert len(records) == 5
    assert all(record.book_id == story_context["book_id"] for record in records)


def test_scene_packet_contains_required_slots_evidence_and_budget(
    client: TestClient,
    session_factory: sessionmaker[Session],
    story_context: dict[str, int],
) -> None:
    """Scene Packet 输出固定槽位、证据链接和预算统计，并持久化结果。"""

    approve_chapter(client, story_context["chapter_id"])

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": story_context["book_id"],
            "chapter_id": story_context["chapter_id"],
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "active_asset_ids": [
                story_context["character_id"],
                story_context["style_id"],
                story_context["foreshadowing_id"],
            ],
            "token_budget": 180,
            "user_intent": "突出角色强撑与谈判压力。",
            "retrieval_snippets": ["港口旧协议要求受伤者退出谈判。", "灯塔信号与旧航线有关。"],
        },
    )
    assert response.status_code == 201, response.text
    packet = response.json()

    required_slots = {
        "章节目标",
        "活跃角色",
        "关系状态",
        "未回收伏笔",
        "风格规则",
        "必须包含事实",
        "必须规避事实",
        "用户意图",
        "证据链接",
    }
    assert required_slots.issubset(packet["packet"].keys())
    assert packet["packet"]["章节目标"] == "林岚在港口谈判中争取维修窗口。"
    assert packet["packet"]["用户意图"] == "突出角色强撑与谈判压力。"
    assert packet["packet"]["活跃角色"][0]["name"] == "林岚"
    assert packet["packet"]["证据链接"]
    assert packet["packet"]["证据链接"] == packet["evidence_links"]
    active_asset_ids = {
        story_context["character_id"],
        story_context["style_id"],
        story_context["foreshadowing_id"],
    }
    evidence_asset_ids = {link["asset_id"] for link in packet["evidence_links"]}
    assert evidence_asset_ids == active_asset_ids
    assert "asset://style/other-scene#v1" not in {link["source_ref"] for link in packet["evidence_links"]}
    fallback = next(link for link in packet["evidence_links"] if link["asset_id"] == story_context["style_id"])
    assert fallback["evidence_type"] == "asset_snapshot"
    assert fallback["source_ref"] == f"asset:{story_context['style_id']}"
    foreshadowing_link = next(
        link for link in packet["evidence_links"] if link["asset_id"] == story_context["foreshadowing_id"]
    )
    assert foreshadowing_link["source_ref"] == "asset://foreshadowing/global#v1"
    assert packet["budget_statistics"]["token_budget"] == 180
    assert packet["budget_statistics"]["used_tokens"] <= 180
    with session_factory() as session:
        stored = session.get(ScenePacket, packet["id"])
    assert stored is not None


def test_scene_packet_low_budget_keeps_hard_constraints_and_active_characters(
    client: TestClient,
    story_context: dict[str, int],
) -> None:
    """预算不足时优先保留硬约束、活跃角色状态和证据。"""

    approve_chapter(client, story_context["chapter_id"])

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": story_context["book_id"],
            "chapter_id": story_context["chapter_id"],
            "scene_goal": "林岚保持冷静。",
            "active_asset_ids": [story_context["character_id"], story_context["style_id"]],
            "token_budget": 45,
            "user_intent": "只保留关键连续性。",
            "retrieval_snippets": [
                "这是一段很长的检索片段，应该在预算不足时被裁剪。" * 8,
            ],
        },
    )

    assert response.status_code == 201, response.text
    packet = response.json()["packet"]
    assert packet["活跃角色"][0]["name"] == "林岚"
    assert "左臂受伤" in packet["必须包含事实"]
    assert "不要直接解释设定" in packet["必须规避事实"]
    assert response.json()["budget_statistics"]["truncated"] is True


def test_scene_packet_trims_retrieval_snippets_without_losing_priority(
    client: TestClient,
    story_context: dict[str, int],
) -> None:
    """检索片段按输入顺序尝试保留，超预算长片段被剔除且统计只计算保留片段。"""

    approve_chapter(client, story_context["chapter_id"])
    first_snippet = "短片段一：港口协议仍有效。"
    long_snippet = "这是一段会被预算裁剪的长检索片段。" * 90
    third_snippet = "短片段二：灯塔信号每七分钟重复。"

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": story_context["book_id"],
            "chapter_id": story_context["chapter_id"],
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "active_asset_ids": [story_context["character_id"], story_context["style_id"]],
            "token_budget": 180,
            "user_intent": "优先保留硬约束与短检索片段。",
            "retrieval_snippets": [first_snippet, long_snippet, third_snippet],
        },
    )

    assert response.status_code == 201, response.text
    result = response.json()
    packet = result["packet"]
    assert packet["检索片段"] == [first_snippet, third_snippet]
    assert long_snippet not in packet["检索片段"]
    assert result["budget_statistics"]["retrieval_tokens"] == (
        _expected_tokens(first_snippet) + _expected_tokens(third_snippet)
    )
    assert "左臂受伤" in packet["必须包含事实"]
    assert "不要直接解释设定" in packet["必须规避事实"]
    assert result["budget_statistics"]["truncated"] is True


def test_scene_packet_filters_continuity_records_by_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
    story_context: dict[str, int],
) -> None:
    """连续性记录只继承当前章节事实和全局事实，避免混入同书其他章节。"""

    approve_chapter(client, story_context["chapter_id"])
    with session_factory() as session:
        session.add_all(
            [
                ContinuityRecord(
                    book_id=story_context["book_id"],
                    scene_id=story_context["other_scene_id"],
                    record_type="next_chapter_constraints",
                    subject="其他章节约束",
                    status="active",
                    payload={
                        "value": ["其他章节事实不得出现"],
                        "chapter_id": story_context["other_chapter_id"],
                    },
                    version=1,
                ),
                ContinuityRecord(
                    book_id=story_context["book_id"],
                    scene_id=None,
                    record_type="next_chapter_constraints",
                    subject="全局约束",
                    status="active",
                    payload={"value": ["全局事实仍需保留"]},
                    version=1,
                ),
            ]
        )
        session.commit()

    response = client.post(
        "/api/scene-packets",
        json={
            "book_id": story_context["book_id"],
            "chapter_id": story_context["chapter_id"],
            "scene_goal": "林岚在港口谈判中争取维修窗口。",
            "active_asset_ids": [story_context["character_id"], story_context["style_id"]],
            "token_budget": 160,
            "user_intent": "验证连续性范围。",
            "retrieval_snippets": [],
        },
    )

    assert response.status_code == 201, response.text
    include_facts = response.json()["packet"]["必须包含事实"]
    assert "林岚必须隐藏伤势" in include_facts
    assert "全局事实仍需保留" in include_facts
    assert "其他章节事实不得出现" not in include_facts


def _expected_tokens(value: str) -> int:
    """复用服务层的轻量预算估算规则，便于验证统计一致性。"""

    return max(1, (len(str(value)) + 5) // 6)
