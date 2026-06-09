from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.retrieval.embedding_client import LocalEmbeddingClient
from app.domains.scene_packets import context_pipeline
from app.domains.scene_packets.schemas import ScenePacketCreate


def _build_scope(session: Session) -> tuple[Chapter, Scene, list[Asset], ScenePacketCreate]:
    book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
    session.add(scene)
    session.flush()
    character = Asset(
        book_id=book.id,
        scene_id=scene.id,
        asset_type="character",
        lineage_key="char-linlan",
        name="林岚",
        status="active",
        payload={"关系": "信任副官"},
        version=1,
    )
    session.add(character)
    session.commit()
    payload = ScenePacketCreate(
        book_id=book.id,
        chapter_id=chapter.id,
        scene_goal="林岚在港口谈判中争取维修窗口。",
        active_asset_ids=[character.id],
        token_budget=220,
        retrieval_snippets=[],
    )
    return chapter, scene, [character], payload


def _capture_clients(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """打桩两条检索缝与 compiled context，只捕获实际传入的 embedding client。"""

    captured: dict[str, object] = {}

    def fake_search_retrieval(session, payload, embedding_client=None, reranker_client=None):
        captured["retrieval"] = embedding_client
        return []

    def fake_recall(session, *, book_id, chapter, assets, continuity_records, embedding_client=None, limit=12):
        captured["memory"] = embedding_client
        return []

    monkeypatch.setattr(context_pipeline, "search_retrieval", fake_search_retrieval)
    monkeypatch.setattr(context_pipeline, "recall_scene_memory_atoms", fake_recall)
    monkeypatch.setattr(context_pipeline, "attach_compiled_context", lambda *args, **kwargs: None)
    return captured


def test_assemble_scene_context_threads_injected_embedding_client(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """注入的 embedding client 必须同时到达检索与长效记忆召回两条缝。"""

    monkeypatch.delenv("STORYFORGE_EMBEDDING_PROVIDER", raising=False)
    captured = _capture_clients(monkeypatch)
    sentinel = LocalEmbeddingClient()
    with session_factory() as session:
        chapter, scene, assets, payload = _build_scope(session)
        context_pipeline.assemble_scene_context(
            session=session,
            payload=payload,
            chapter=chapter,
            scene=scene,
            assets=assets,
            continuity_records=[],
            evidence_links=[],
            embedding_client=sentinel,
        )
    assert captured["retrieval"] is sentinel
    assert captured["memory"] is sentinel


def test_assemble_scene_context_defaults_to_keyword_path_without_provider(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """未配置 provider 且未注入 client 时保持关键词路径：两条缝都收到 None。"""

    monkeypatch.delenv("STORYFORGE_EMBEDDING_PROVIDER", raising=False)
    captured = _capture_clients(monkeypatch)
    with session_factory() as session:
        chapter, scene, assets, payload = _build_scope(session)
        context_pipeline.assemble_scene_context(
            session=session,
            payload=payload,
            chapter=chapter,
            scene=scene,
            assets=assets,
            continuity_records=[],
            evidence_links=[],
        )
    assert captured["retrieval"] is None
    assert captured["memory"] is None
