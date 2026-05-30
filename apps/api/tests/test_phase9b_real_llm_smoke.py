from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from threading import Thread
from types import SimpleNamespace

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.book_runs.phase9b_real_llm_smoke import (
    Phase9BRealLlmSmokePreflightError,
    main,
    missing_phase9b_real_llm_env,
    run_phase9b_real_llm_smoke,
)
from app.domains.books.models import Scene
from app.domains.model_runs.models import ModelRun


class _Phase9BChatHandler(BaseHTTPRequestHandler):
    """模拟 OpenAI 兼容 Chat Completions，用于验证真实协议边界（生成 + Judge）。"""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        self.__class__.requests.append({"headers": dict(self.headers), "payload": payload})
        system_prompt = payload["messages"][0]["content"] if payload["messages"] else ""
        user_prompt = payload["messages"][-1]["content"]
        if "结构化一致性评审员" in system_prompt:
            response_content = "[]"
        else:
            response_content = f"真实模型章节正文：{user_prompt[:32]}。林岚完成调查并留下审计证据。"
        body = json.dumps(
            {
                "choices": [{"message": {"content": response_content}}],
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


def test_phase9b_real_llm_smoke_reports_missing_private_env(session: Session) -> None:
    """缺少私有真实 LLM 配置时应明确阻止冒烟，且不触碰外部网络。"""

    assert missing_phase9b_real_llm_env({}) == [
        "STORYFORGE_LLM_API_KEY",
        "STORYFORGE_LLM_BASE_URL",
        "STORYFORGE_LLM_MODEL",
        "STORYFORGE_LLM_PROVIDER",
    ]

    with pytest.raises(Phase9BRealLlmSmokePreflightError, match="STORYFORGE_LLM_API_KEY"):
        run_phase9b_real_llm_smoke(session, chapter_count=1, token_budget=1000, env={})


def test_phase9b_real_llm_smoke_runs_one_chapter_and_records_evidence(session: Session) -> None:
    """1 章真实 LLM 冒烟应完成 BookRun、记录 token，并导出可审计制品。"""

    _Phase9BChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Phase9BChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-key",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "700",
    }
    import os
    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_phase9b_real_llm_smoke(session, chapter_count=1, token_budget=1000, env=env)
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.total_chapters == 1
    assert result.book_run.tokens_used == 323
    assert result.markdown_artifact.name == "book.md"
    assert result.audit_artifact.name == "audit_report.json"
    assert len(_Phase9BChatHandler.requests) == 2
    draft_request = _Phase9BChatHandler.requests[0]
    assert draft_request["payload"]["max_completion_tokens"] == 700
    assert draft_request["headers"]["Authorization"] == "Bearer test-private-key"
    judge_request = _Phase9BChatHandler.requests[1]
    assert "结构化一致性评审员" in judge_request["payload"]["messages"][0]["content"]

    model_run = session.query(ModelRun).one()
    assert model_run.provider_name == "openai-compatible"
    assert model_run.model_name == "test-real-model"
    assert model_run.token_usage == 323
    assert model_run.payload["book_run_id"] == result.book_run.id
    assert model_run.payload["token_usage_source"] == "provider_usage"

    scene = session.query(Scene).one()
    assert scene.status == "approved"
    assert "真实模型章节正文" in scene.content
    assert "test-private-key" not in str(result.audit_artifact.payload)

    audit = result.audit_artifact.payload
    assert audit["quality_summary"]["average_score"] == 100
    assert audit["quality_summary"]["scored_chapter_count"] == 1
    assert audit["chapters"][0]["quality_score"] == 100


class _FakeSession:
    def __enter__(self) -> str:
        return "fake-session"

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


def test_phase9b_real_llm_smoke_cli_prints_summary_without_secret() -> None:
    """CLI 入口应输出可粘贴到验证报告的摘要，且不能泄露密钥。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-key",
        "STORYFORGE_LLM_BASE_URL": "http://provider.test/v1",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(session: str, *, chapter_count: int, token_budget: int, env: dict[str, str]):
        assert session == "fake-session"
        assert chapter_count == 1
        assert token_budget == 1000
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-key"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=7, status="completed", tokens_used=323, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=8, name="book.md"),
            audit_artifact=SimpleNamespace(id=9, name="audit_report.json"),
            chapter_count=1,
        )

    exit_code = main(
        ["--chapter-count", "1", "--token-budget", "1000"],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    summary = json.loads(output.getvalue())
    assert summary == {
        "book_run_id": 7,
        "status": "completed",
        "chapter_count": 1,
        "tokens_used": 323,
        "estimated_cost": 0.0,
        "markdown_artifact_id": 8,
        "markdown_artifact_name": "book.md",
        "audit_artifact_id": 9,
        "audit_artifact_name": "audit_report.json",
    }
    assert error.getvalue() == ""
    assert "test-private-key" not in output.getvalue()


def test_phase9b_real_llm_smoke_module_registers_relationship_models_for_direct_cli() -> None:
    """直接导入 CLI 模块后应能配置 mapper，覆盖真实命令行入口路径。"""

    script = (
        "from sqlalchemy.orm import configure_mappers; "
        "import app.domains.book_runs.phase9b_real_llm_smoke; "
        "configure_mappers()"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=False)

    assert result.returncode == 0, result.stderr




def test_phase9b_real_llm_smoke_persistent_schema_contains_workspace_columns(engine) -> None:
    """持久化迁移路径需要包含工作区表和 books.workspace_id，匹配真实 CLI 使用的 ORM 模型。"""

    inspector = inspect(engine)

    assert "workspaces" in inspector.get_table_names()
    book_columns = {column["name"] for column in inspector.get_columns("books")}
    assert "workspace_id" in book_columns



