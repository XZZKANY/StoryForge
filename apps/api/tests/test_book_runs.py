from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.domains.books.models import Book, Chapter
from app.domains.timeline.service import list_timeline_events
from app.main import app


def seed_locked_blueprint(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """创建 BookRun API 所需的 locked Blueprint。"""

    with session_factory() as session:
        book = Book(title="雾港航线", status="draft", premise="调查灯塔信号。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="林岚在雾港追查失真的灯塔信号。",
            tone="克制悬疑",
            target_word_count=4500,
            target_chapter_count=3,
            chapter_word_count_min=1000,
            chapter_word_count_max=1800,
            status="locked",
            version=2,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        return {"book_id": book.id, "blueprint_id": blueprint.id}


def seed_planned_chapters(session_factory: sessionmaker[Session], scope: dict[str, int], count: int) -> list[int]:
    """为 BookRun progress 准备可被 TimelineEvent 校验的真实章节。"""

    with session_factory() as session:
        chapters = [
            Chapter(
                book_id=scope["book_id"],
                blueprint_id=scope["blueprint_id"],
                ordinal=index,
                title=f"第 {index} 章",
                status="planned",
                summary=f"第 {index} 章摘要。",
            )
            for index in range(1, count + 1)
        ]
        session.add_all(chapters)
        session.commit()
        return [chapter.id for chapter in chapters]


def test_create_and_read_book_run(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BookRun API 应能启动并读取三章短篇运行记录。"""

    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "deterministic")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "storyforge-deterministic-writer")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")

    scope = seed_locked_blueprint(session_factory)

    created_response = client.post("/api/book-runs", json=scope)

    assert created_response.status_code == 201, created_response.text
    created = created_response.json()
    assert created["book_id"] == scope["book_id"]
    assert created["blueprint_id"] == scope["blueprint_id"]
    assert created["status"] == "running"
    assert created["current_chapter_index"] == 1
    assert created["total_chapters"] == 3
    assert created["progress"]["completed_chapters"] == []
    provider_resolution = created["progress"]["provider_resolution"]
    assert provider_resolution["provider_name"] == "deterministic"
    assert provider_resolution["capability"] == "llm"
    assert provider_resolution["ok"] is True
    assert provider_resolution["credential_status"] == "not_required"
    assert "credential_ref" not in provider_resolution
    assert created["checkpoint"] == []
    assert created["tokens_used"] == 0
    assert created["cost_summary"] == {"estimated_cost": 0.0}

    read_response = client.get(f"/api/book-runs/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["id"] == created["id"]


def test_create_book_run_accepts_budget_limits(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 启动时应保存 token、时间和章节预算硬上限。"""

    scope = seed_locked_blueprint(session_factory)

    response = client.post(
        "/api/book-runs",
        json={**scope, "token_budget": 1200, "time_budget_sec": 300, "chapter_budget": 2},
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["token_budget"] == 1200
    assert created["time_budget_sec"] == 300
    assert created["chapter_budget"] == 2
    assert created["tokens_used"] == 0


def test_create_book_run_records_missing_provider_fallback(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实 LLM provider 缺少密钥时，BookRun progress 应记录不可用摘要。"""

    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "gpt-5.5")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")

    scope = seed_locked_blueprint(session_factory)
    response = client.post("/api/book-runs", json=scope)

    assert response.status_code == 201, response.text
    provider_resolution = response.json()["progress"]["provider_resolution"]
    assert provider_resolution["ok"] is False
    assert provider_resolution["provider_name"] == "deterministic"
    assert provider_resolution["credential_status"] == "missing_fallback"
    assert provider_resolution["model_aliases"]["configured_provider"] == "openai"
    assert "缺少密钥" in provider_resolution["unavailable_reason"]
    assert "credential_ref" not in provider_resolution


def test_create_book_run_requires_locked_blueprint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """未锁定 Blueprint 不能启动 BookRun。"""

    with session_factory() as session:
        book = Book(title="未锁定作品", status="draft", premise="仍在规划。")
        session.add(book)
        session.flush()
        blueprint = BookBlueprint(
            book_id=book.id,
            premise="未锁定蓝图。",
            tone="克制",
            target_word_count=3000,
            target_chapter_count=3,
            chapter_word_count_min=800,
            chapter_word_count_max=1200,
            status="draft",
            version=1,
            metadata_={},
        )
        session.add(blueprint)
        session.commit()
        book_id = book.id
        blueprint_id = blueprint.id

    response = client.post("/api/book-runs", json={"book_id": book_id, "blueprint_id": blueprint_id})

    assert response.status_code == 422, response.text
    assert response.json() == {"detail": "Blueprint 尚未锁定，不能启动 BookRun。"}


def test_apply_book_run_progress_marks_completed(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookLoop 完成结果应持久化到 BookRun 状态和进度。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
            {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
        ]
    }

    with session_factory() as session:
        updated = apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(status="completed", current_chapter_index=3, progress=progress),
        )

    assert updated.status == "completed"
    assert updated.current_chapter_index == 3
    assert updated.progress["completed_chapters"] == progress["completed_chapters"]
    assert updated.progress["provider_resolution"]["provider_name"] == "deterministic"

    read_response = client.get(f"/api/book-runs/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["status"] == "completed"


def test_apply_book_run_progress_syncs_completed_chapter_to_timeline_once(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 完章进度应同步为 TimelineEvent，并对重复回填保持幂等。"""

    scope = seed_locked_blueprint(session_factory)
    chapter_ids = seed_planned_chapters(session_factory, scope, 1)
    created = client.post("/api/book-runs", json=scope).json()
    completed_chapter = {
        "chapter_index": 1,
        "chapter_id": chapter_ids[0],
        "model_run_id": 11,
        "judge_report_id": 12,
        "approved_scene_id": 13,
        "summary": "林岚确认灯塔信号来自旧航道。",
    }

    with session_factory() as session:
        apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(
                status="running",
                current_chapter_index=1,
                progress={"completed_chapters": [completed_chapter]},
            ),
        )
        apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(
                status="running",
                current_chapter_index=1,
                progress={"completed_chapters": [completed_chapter]},
            ),
        )
        events = list(list_timeline_events(session, book_id=scope["book_id"]))

    assert len(events) == 1
    event = events[0]
    assert event.project_id == 1
    assert event.book_id == scope["book_id"]
    assert event.volume_id == 1
    assert event.chapter_id == chapter_ids[0]
    assert event.time_order == 1
    assert event.summary == "林岚确认灯塔信号来自旧航道。"
    assert event.evidence_refs == [
        f"book_run:{created['id']}",
        f"chapter:{chapter_ids[0]}",
        "model_run:11",
        "judge_report:12",
        "approved_scene:13",
    ]
    assert event.payload["source"] == f"book_run:{created['id']}"
    assert event.payload["completed_chapter"]["chapter_index"] == 1
    assert event.payload["defaulted_fields"] == {
        "project_id": "BookRun progress 未提供 project_id，当前作品模型没有项目字段，使用受控默认 1。",
        "volume_id": "BookRun progress 未提供 volume_id，当前章节模型没有卷字段，使用受控默认 1。",
    }


def test_apply_book_run_progress_syncs_timeline_without_per_chapter_queries(
    client: TestClient,
    session_factory: sessionmaker[Session],
    engine,
) -> None:
    """批量完章回填应预取章节和已有事件，避免 Timeline 同步随章节数 N+1 放大。"""

    scope = seed_locked_blueprint(session_factory)
    chapter_ids = seed_planned_chapters(session_factory, scope, 8)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {
                "chapter_index": index,
                "chapter_id": chapter_id,
                "model_run_id": index * 10 + 1,
                "judge_report_id": index * 10 + 2,
                "approved_scene_id": index * 10 + 3,
                "summary": f"第 {index} 章完成。",
            }
            for index, chapter_id in enumerate(chapter_ids, start=1)
        ]
    }
    statements: list[str] = []

    def record_statement(conn, cursor, statement, parameters, context, executemany) -> None:  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with session_factory() as session:
            apply_book_run_progress(
                session,
                created["id"],
                BookRunProgressUpdate(status="completed", current_chapter_index=3, progress=progress),
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    timeline_events = [statement for statement in statements if "timeline_events" in statement]
    assert len(statements) <= 20
    assert len(timeline_events) <= 10

    with session_factory() as session:
        events = list(list_timeline_events(session, book_id=scope["book_id"]))

    assert len(events) == 8
    assert [event.chapter_id for event in events] == chapter_ids


def test_apply_book_run_progress_keeps_awaiting_review_chapter(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节暂停时 BookRun 应停在阻塞章节，后续章节不被标记完成。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
        ],
        "blocked_chapter": {"chapter_index": 2, "judge_report_id": 20, "repair_patch_id": 21},
    }

    with session_factory() as session:
        updated = apply_book_run_progress(
            session,
            created["id"],
            BookRunProgressUpdate(status="awaiting_review", current_chapter_index=2, progress=progress),
        )

    assert updated.status == "awaiting_review"
    assert updated.current_chapter_index == 2
    assert updated.progress["blocked_chapter"]["chapter_index"] == 2


def test_patch_book_run_progress_persists_manual_read_gate(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun progress 应保存人工通读门禁，并用 awaiting_review 表达阻断。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    manual_read_gate = {
        "status": "blocked",
        "reason": "10 章真实 LLM 样章需要人工通读确认。",
        "required_chapter_count": 10,
        "word_count_range": {"min": 30000, "max": 50000},
        "blocked_at_chapter_index": 3,
    }

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "awaiting_review",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                    {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                ],
                "manual_read_gate": manual_read_gate,
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "awaiting_review"
    assert updated["current_chapter_index"] == 3
    assert updated["progress"]["manual_read_gate"] == manual_read_gate


def test_patch_book_run_progress_persists_manual_read_review(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """结构化人工盲评应携带各维度数值评分，并写入 progress。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "manual_read_review": {
                "status": "passed",
                "reviewer": "人工盲评 A",
                "reviewed_chapter_count": 10,
                "word_count": 36000,
                "blind": True,
                "dimension_scores": [
                    {"dimension": "narrative_quality", "score": 4, "comment": "推进顺畅。"},
                    {"dimension": "character_consistency", "score": 5},
                ],
                "conclusion": "通过人工盲评门禁。",
            },
        },
    )

    assert response.status_code == 200, response.text
    review = response.json()["progress"]["manual_read_review"]
    assert review["status"] == "passed"
    assert review["blind"] is True
    assert [item["dimension"] for item in review["dimension_scores"]] == [
        "narrative_quality",
        "character_consistency",
    ]
    # overall_score 未显式提供，按各维度均值自动计算 (4 + 5) / 2 = 4.5
    assert review["overall_score"] == 4.5


def test_patch_book_run_progress_rejects_invalid_review_dimension(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """非法盲评维度应被 schema 拒绝。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 1,
            "manual_read_review": {
                "status": "passed",
                "reviewer": "人工盲评 A",
                "reviewed_chapter_count": 1,
                "word_count": 3000,
                "dimension_scores": [{"dimension": "not_a_dimension", "score": 3}],
                "conclusion": "结论。",
            },
        },
    )

    assert response.status_code == 422, response.text


def test_manual_read_review_is_sticky_across_progress_updates(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """后续不带盲评的 progress 回填不应冲掉已写入的人工盲评记录。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 1,
            "manual_read_review": {
                "status": "passed",
                "reviewer": "人工盲评 A",
                "reviewed_chapter_count": 1,
                "word_count": 3000,
                "dimension_scores": [{"dimension": "narrative_quality", "score": 4}],
                "conclusion": "通过。",
            },
        },
    )

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 2,
            "progress": {"completed_chapters": []},
        },
    )

    assert response.status_code == 200, response.text
    review = response.json()["progress"]["manual_read_review"]
    assert review["reviewer"] == "人工盲评 A"
    assert review["overall_score"] == 4.0


def test_progress_update_persists_checkpoint_and_budget_usage(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun progress 回填应生成只含引用 id 的 checkpoint，并保存预算用量。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 1000}).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "budget": {"tokens_used": 840, "estimated_cost": 0.42},
    }

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 2, "progress": progress},
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "paused_by_budget"
    assert updated["tokens_used"] == 840
    assert updated["cost_summary"] == {"estimated_cost": 0.42, "token_budget": 1000, "tokens_remaining": 160}
    assert updated["checkpoint"] == [
        {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
        {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
    ]
    assert "final_draft" not in str(updated["checkpoint"])


def test_progress_update_persists_memory_atom_references_without_draft(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """memory_extract 的真实写入引用应进入 checkpoint 和时间线，但不能保存正文。"""

    scope = seed_locked_blueprint(session_factory)
    chapter_ids = seed_planned_chapters(session_factory, scope, 1)
    created = client.post("/api/book-runs", json=scope).json()
    completed_chapter = {
        "chapter_index": 1,
        "chapter_id": chapter_ids[0],
        "model_run_id": 11,
        "judge_report_id": 12,
        "approved_scene_id": 13,
        "memory_atom_ids": ["memory_extract:1:chapter_summary:1"],
        "final_draft": "完整正文不应进入 checkpoint。",
    }

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "running",
            "current_chapter_index": 1,
            "progress": {"completed_chapters": [completed_chapter]},
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["checkpoint"] == [
        {
            "chapter_index": 1,
            "model_run_id": 11,
            "judge_report_id": 12,
            "approved_scene_id": 13,
            "memory_atom_ids": ["memory_extract:1:chapter_summary:1"],
        }
    ]
    assert "完整正文" not in str(updated["checkpoint"])
    with session_factory() as session:
        events = list(list_timeline_events(session, book_id=scope["book_id"]))
    assert "memory:memory_extract:1:chapter_summary:1" in events[0].evidence_refs


def test_progress_update_auto_pauses_when_token_budget_is_reached(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Token 预算触顶时服务层应强制暂停并记录原因。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 1000}).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "running",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": [{"chapter_index": 1, "model_run_id": 11}],
                "budget": {"tokens_used": 1000, "elapsed_time_sec": 120, "estimated_cost": 0.5},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "paused_by_budget"
    assert updated["progress"]["pause_reason"] == "token 预算触顶：已使用 1000/1000 tokens。"
    assert updated["progress"]["budget_exceeded"] == {
        "kind": "token",
        "used": 1000,
        "limit": 1000,
    }
    assert updated["cost_summary"]["tokens_remaining"] == 0


def test_progress_update_auto_pauses_when_time_budget_is_reached(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """时间预算触顶时服务层应强制暂停并记录原因。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "time_budget_sec": 300}).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "running",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": [{"chapter_index": 1, "model_run_id": 11}],
                "budget": {"tokens_used": 100, "elapsed_time_sec": 300, "estimated_cost": 0.05},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "paused_by_budget"
    assert updated["progress"]["pause_reason"] == "时间预算触顶：已用 300/300 秒。"
    assert updated["progress"]["budget_exceeded"] == {
        "kind": "time",
        "used": 300,
        "limit": 300,
    }


def test_progress_update_keeps_completed_when_token_budget_is_reached(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """completed 状态代表运行闭环已结束，不能被 token 预算门禁误改。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 1000}).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11},
                    {"chapter_index": 2, "model_run_id": 21},
                    {"chapter_index": 3, "model_run_id": 31},
                ],
                "budget": {"tokens_used": 1000, "elapsed_time_sec": 120, "estimated_cost": 0.5},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "completed"
    assert "budget_exceeded" not in updated["progress"]
    assert "pause_reason" not in updated["progress"]


def test_progress_update_keeps_completed_when_time_budget_is_reached(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """completed 状态代表运行闭环已结束，不能被 time 预算门禁误改。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "time_budget_sec": 300}).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11},
                    {"chapter_index": 2, "model_run_id": 21},
                    {"chapter_index": 3, "model_run_id": 31},
                ],
                "budget": {"tokens_used": 100, "elapsed_time_sec": 300, "estimated_cost": 0.05},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["status"] == "completed"
    assert "budget_exceeded" not in updated["progress"]
    assert "pause_reason" not in updated["progress"]


def test_progress_update_auto_pauses_when_chapter_budget_is_reached_but_not_completed(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """章节预算触顶且 BookRun 未完成时应暂停，completed 不应被误暂停。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "chapter_budget": 2}).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11},
            {"chapter_index": 2, "model_run_id": 21},
        ],
        "budget": {"tokens_used": 200, "elapsed_time_sec": 60, "estimated_cost": 0.1},
    }

    paused_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "running", "current_chapter_index": 2, "progress": progress},
    )

    assert paused_response.status_code == 200, paused_response.text
    paused = paused_response.json()
    assert paused["status"] == "paused_by_budget"
    assert paused["progress"]["pause_reason"] == "章节预算触顶：已到第 2/2 章。"
    assert paused["progress"]["budget_exceeded"] == {
        "kind": "chapter",
        "used": 2,
        "limit": 2,
    }

    completed_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "completed", "current_chapter_index": 3, "progress": progress},
    )

    assert completed_response.status_code == 200, completed_response.text
    assert completed_response.json()["status"] == "completed"


def test_resume_book_run_continues_after_latest_checkpoint(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Resume 应从最近 checkpoint 的下一章继续，避免重复批准已完成章节。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
            {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
        ],
        "budget": {"tokens_used": 980, "estimated_cost": 0.51},
    }
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 2, "progress": progress},
    )

    response = client.post(f"/api/book-runs/{created['id']}/resume")

    assert response.status_code == 200, response.text
    resumed = response.json()
    assert resumed["status"] == "running"
    assert resumed["current_chapter_index"] == 3
    assert resumed["progress"]["resume_from_chapter_index"] == 3
    assert resumed["progress"]["completed_chapters"] == progress["completed_chapters"]


def test_book_run_control_endpoints_pause_stop_and_retry(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Assistant 控制按钮必须通过 BookRun 原生端点真实更新状态。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    pause_response = client.post(f"/api/book-runs/{created['id']}/pause", json={"reason": "用户暂停检查"})
    assert pause_response.status_code == 200, pause_response.text
    paused = pause_response.json()
    assert paused["status"] == "paused_by_user"
    assert paused["progress"]["pause_reason"] == "用户暂停检查"

    resume_response = client.post(f"/api/book-runs/{created['id']}/resume")
    assert resume_response.status_code == 200, resume_response.text
    assert resume_response.json()["status"] == "running"

    progress = {
        "completed_chapters": [{"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}]
    }
    client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_budget", "current_chapter_index": 1, "progress": progress},
    )

    retry_response = client.post(f"/api/book-runs/{created['id']}/retry")
    assert retry_response.status_code == 200, retry_response.text
    retried = retry_response.json()
    assert retried["status"] == "running"
    assert retried["current_chapter_index"] == 2
    assert retried["progress"]["retry_from_chapter_index"] == 2

    stop_response = client.post(f"/api/book-runs/{created['id']}/stop", json={"reason": "用户停止"})
    assert stop_response.status_code == 200, stop_response.text
    stopped = stop_response.json()
    assert stopped["status"] == "stopped"
    assert stopped["progress"]["stop_reason"] == "用户停止"


def test_book_run_control_rejects_extra_sensitive_fields(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 控制请求不得静默接收 API Key 等额外敏感字段。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.post(
        f"/api/book-runs/{created['id']}/pause",
        json={"reason": "用户暂停", "api_key": "secret-should-not-enter-control-payload"},
    )

    assert response.status_code == 422, response.text
    assert "api_key" in response.text
    assert "secret-should-not-enter-control-payload" not in response.text


def test_patch_book_run_progress_endpoint(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """Workflow adapter 可通过 HTTP 回填 BookRun completed 状态。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    created_provider_resolution = created["progress"]["provider_resolution"]

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13},
                    {"chapter_index": 2, "model_run_id": 21, "judge_report_id": 22, "approved_scene_id": 23},
                    {"chapter_index": 3, "model_run_id": 31, "judge_report_id": 32, "approved_scene_id": 33},
                ],
                "provider_resolution": {"provider_name": "workflow-shadow", "credential_ref": "secret"},
            },
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"
    assert response.json()["current_chapter_index"] == 3
    assert response.json()["progress"]["provider_resolution"] == created_provider_resolution


def test_progress_update_persists_book_run_latency_aggregates(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """BookRun 应从已完成章节记录中持久化总、最大和平均 latency。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()

    response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "completed",
            "current_chapter_index": 3,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "generation_latency_ms": 120},
                    {"chapter_index": 2, "model_run_id": 21, "generation_latency_ms": 80},
                    {"chapter_index": 3, "model_run_id": 31, "generation_latency_ms": 100},
                ],
                "budget": {"tokens_used": 300, "elapsed_time_sec": 9, "estimated_cost": 0.03},
            },
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["total_latency_ms"] == 300
    assert updated["max_latency_ms"] == 120
    assert updated["avg_latency_ms"] == 100


def test_patch_book_run_volume_progress_is_controlled_by_volume_contract(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """卷级摘要只能由受控契约写入，普通 progress 字典不能污染。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    volume_progress = {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 3},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }

    first_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "running",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": [
                    {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
                ]
            },
            "volume_progress": volume_progress,
        },
    )

    assert first_response.status_code == 200, first_response.text
    first_progress = first_response.json()["progress"]
    assert first_progress["volume"] == volume_progress
    assert first_progress["current_volume"] == 1
    assert first_progress["chapter_range"] == {"start": 1, "end": 3}
    assert first_progress["volume_checkpoint"] == volume_progress

    polluted_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={
            "status": "awaiting_review",
            "current_chapter_index": 2,
            "progress": {
                "completed_chapters": first_progress["completed_chapters"],
                "volume": {"current_volume": 99},
                "current_volume": 99,
                "chapter_range": {"start": 99, "end": 100},
                "volume_checkpoint": {"current_volume": 99},
            },
        },
    )

    assert polluted_response.status_code == 200, polluted_response.text
    polluted_progress = polluted_response.json()["progress"]
    assert polluted_progress["volume"] == volume_progress
    assert polluted_progress["current_volume"] == 1
    assert polluted_progress["chapter_range"] == {"start": 1, "end": 3}
    assert polluted_progress["volume_checkpoint"] == volume_progress

    schemas = app.openapi()["components"]["schemas"]
    volume_schema = schemas["BookRunProgressUpdate"]["properties"]["volume_progress"]
    assert "BookRunVolumeProgress" in schemas
    assert {"$ref": "#/components/schemas/BookRunVolumeProgress"} in volume_schema["anyOf"]
