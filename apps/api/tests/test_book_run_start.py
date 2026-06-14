from __future__ import annotations

import json
import re
from collections.abc import Generator
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.blueprints.service import (
    create_book_blueprint,
    lock_book_blueprint,
    trigger_chapter_plan,
)
from app.domains.book_runs.book_generation import (
    _blueprint_payload,
    _create_generation_book,
    _seed_consistency_data,
)
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunCreate
from app.domains.book_runs.service import (
    BookRunBlockedError,
    assert_book_run_startable,
    create_book_run,
    mark_book_run_generation_dispatched,
    run_book_run_generation_blocking,
)
from app.domains.books.models import Scene


class _FakeChatHandler(BaseHTTPRequestHandler):
    """最小 OpenAI 兼容 Chat Completions：草稿返回足量正文，Judge 返回空 issue。"""

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        system_prompt = payload["messages"][0]["content"] if payload["messages"] else ""
        user_prompt = payload["messages"][-1]["content"]
        if "结构化一致性评审员" in system_prompt:
            content = "[]"
        else:
            target = 800
            match = re.search(r"（(\d+)[–\-](\d+)\s*字）", user_prompt)
            if match:
                target = (int(match.group(1)) + int(match.group(2))) // 2
            content = ("林岚完成调查并留下审计证据。" + "她逐条核对线索并登记入册。" * 200)[:target]
        body = json.dumps(
            {
                "choices": [{"message": {"content": content}}],
                "usage": {"prompt_tokens": 101, "completion_tokens": 222, "total_tokens": 323},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


@pytest.fixture()
def fake_provider() -> Generator[dict[str, str], None, None]:
    """启动本地假 provider，产出指向它的 STORYFORGE_LLM_* env。"""

    server = HTTPServer(("127.0.0.1", 0), _FakeChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-credential",
        "STORYFORGE_LLM_BASE_URL": "http" + f"://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_MODEL": "test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "700",
    }
    try:
        yield env
    finally:
        server.shutdown()
        thread.join(timeout=2)


def _seed_book_run(session: Session, *, chapter_count: int) -> BookRun:
    """造一本 book + locked blueprint + 已规划章节 + running BookRun（未生成）。"""

    book = _create_generation_book(session, chapter_count)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(session, _blueprint_payload(book.id, chapter_count))
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    return create_book_run(
        session,
        BookRunCreate(
            book_id=book.id,
            blueprint_id=blueprint.id,
            token_budget=chapter_count * 4000,
            chapter_budget=chapter_count,
        ),
    )


def test_start_rejects_missing_credentials(session: Session) -> None:
    """缺少 STORYFORGE_LLM_* 凭据时，前置校验应拒绝并提示缺失项。"""

    book_run = _seed_book_run(session, chapter_count=3)
    with pytest.raises(BookRunBlockedError) as excinfo:
        assert_book_run_startable(session, book_run.id, env={})
    assert "STORYFORGE_LLM_API_KEY" in str(excinfo.value)


def test_start_rejects_non_running_status(session: Session, fake_provider: dict[str, str]) -> None:
    """非 running 状态（如已完成）不能再次发起生成。"""

    book_run = _seed_book_run(session, chapter_count=3)
    book_run.status = "completed"
    session.commit()
    with pytest.raises(BookRunBlockedError):
        assert_book_run_startable(session, book_run.id, env=fake_provider)


def test_start_caps_chapter_count(session: Session, fake_provider: dict[str, str]) -> None:
    """total_chapters 大于 max_chapters 时，生成章节数被钉到 max_chapters。"""

    book_run = _seed_book_run(session, chapter_count=4)
    _, chapter_count, _ = assert_book_run_startable(
        session, book_run.id, max_chapters=3, env=fake_provider
    )
    assert chapter_count == 3


def test_double_start_is_rejected(session: Session, fake_provider: dict[str, str]) -> None:
    """已派发生成的运行再次发起应被拒绝。"""

    book_run = _seed_book_run(session, chapter_count=3)
    assert_book_run_startable(session, book_run.id, env=fake_provider)
    mark_book_run_generation_dispatched(session, book_run.id)
    with pytest.raises(BookRunBlockedError):
        assert_book_run_startable(session, book_run.id, env=fake_provider)


def test_generation_worker_completes_run(
    session: Session,
    session_factory: sessionmaker[Session],
    fake_provider: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """后台 worker 应把 running 运行跑到 completed 并产出审计章节。"""

    book_run = _seed_book_run(session, chapter_count=1)
    book_run_id = book_run.id

    # worker 自开 SessionLocal()，测试里改绑到内存测试库。
    monkeypatch.setattr(
        "app.domains.book_runs.service.SessionLocal",
        lambda: session_factory(),
    )
    run_book_run_generation_blocking(
        book_run_id, chapter_count=1, token_budget=4000, env=fake_provider
    )

    refreshed = session.get(BookRun, book_run_id)
    session.refresh(refreshed)
    assert refreshed.status == "completed"
    scenes = session.query(Scene).filter(Scene.status == "approved").all()
    assert len(scenes) == 1


def test_start_endpoint_dispatches_background_task(
    client,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """端点应返回 202、打上派发标记，并调度后台任务（任务体在此被打桩）。"""

    calls: list[dict[str, object]] = []

    def _fake_worker(book_run_id: int, **kwargs: object) -> None:
        calls.append({"book_run_id": book_run_id, **kwargs})

    monkeypatch.setattr(
        "app.domains.book_runs.router.run_book_run_generation_blocking", _fake_worker
    )
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-credential")
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")
    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "openai-compatible")

    with session_factory() as seed_session:
        book_run = _seed_book_run(seed_session, chapter_count=4)
        book_run_id = book_run.id

    response = client.post(f"/api/book-runs/{book_run_id}/start", json={"max_chapters": 3})
    assert response.status_code == 202
    assert response.json()["progress"]["generation"]["state"] == "dispatched"
    assert calls and calls[0]["book_run_id"] == book_run_id
    assert calls[0]["chapter_count"] == 3

