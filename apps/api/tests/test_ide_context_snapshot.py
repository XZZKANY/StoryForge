from __future__ import annotations

from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.domains.books.models import Book, Chapter, Scene
from app.domains.context_compiler.schemas import ContextBlock, ContextCompileRequest
from app.domains.context_compiler.service import compile_context, persist_compiled_context


def test_read_context_snapshot_returns_budget_blocks_and_debug_summary(
    client: TestClient,
    session: Session,
) -> None:
    """Context Inspector 应能按 compiled_context_id 回放已持久化的上下文快照。"""

    book, chapter, scene = _create_book_chapter_scene(session)
    compiled = compile_context(
        ContextCompileRequest(
            novel_id=book.id,
            chapter_id=chapter.id,
            scene_id=scene.id,
            token_budget=60,
            blocks=[
                ContextBlock(
                    block_id="goal",
                    kind="scene_goal",
                    title="场景目标",
                    content="林岚必须在旧港隐藏身份。",
                    source_ref="scene:1",
                    token_count=20,
                    priority="required",
                    injection_position="scene",
                ),
                ContextBlock(
                    block_id="memory",
                    kind="memory_atom",
                    title="角色记忆",
                    content="林岚信任副官。",
                    source_ref="memory:1",
                    token_count=20,
                    priority="high",
                    injection_position="memory",
                ),
                ContextBlock(
                    block_id="style",
                    kind="style_rule",
                    title="风格规则",
                    content="保持克制，不解释人物动机。",
                    source_ref="style:1",
                    token_count=40,
                    priority="low",
                    injection_position="style",
                ),
            ],
        )
    )
    persist_compiled_context(session, compiled)

    response = client.get(f"/api/ide/context-snapshot/{compiled.compiled_context_id}")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["compiled_context_id"] == compiled.compiled_context_id
    assert payload["book_id"] == book.id
    assert payload["chapter_id"] == chapter.id
    assert payload["scene_id"] == scene.id
    assert payload["budget"] == {
        "token_budget": 60,
        "used_tokens": 40,
        "dropped_tokens": 40,
        "truncated": True,
    }
    assert [block["block_id"] for block in payload["injected_blocks"]] == ["memory", "goal"]
    assert payload["injected_blocks"][0]["source_ref"] == "memory:1"
    assert payload["dropped_blocks"][0]["block_id"] == "style"
    assert payload["dropped_blocks"][0]["reason"] == "超过剩余 token 预算，按优先级裁剪。"
    assert payload["debug_summary"] == compiled.debug_summary


def test_read_context_snapshot_returns_explicit_evicted_message(client: TestClient) -> None:
    """快照缺失时必须显式提示 evicted，禁止静默返回空壳。"""

    response = client.get("/api/ide/context-snapshot/ctx_missing")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "snapshot evicted at unknown: ctx_missing"}


def _create_book_chapter_scene(session: Session) -> tuple[Book, Chapter, Scene]:
    book = Book(title="上下文巡检", status="draft", premise="验证 Context Inspector。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="抵达旧港。")
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="码头", status="draft", content="林岚抵达旧港。")
    session.add(scene)
    session.commit()
    return book, chapter, scene
