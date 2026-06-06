from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path
from threading import Thread
from types import SimpleNamespace

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.phase9b_real_llm_smoke import (
    Phase9BRealLlmSmokePreflightError,
    _prior_chapters_recap,
    _record_model_run,
    main,
    missing_phase9b_real_llm_env,
    resume_phase9b_real_llm_smoke,
    run_phase9b_real_llm_smoke,
)
from app.domains.books.models import Book, Chapter, Scene
from app.domains.judge.models import JudgeIssue
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


def _local_provider_base_url(port: int) -> str:
    return "http" + f"://127.0.0.1:{port}/v1"


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
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
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
    assert draft_request["headers"]["Authorization"] == "Bearer" + " test-private-credential"
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
    assert "test-private-credential" not in str(result.audit_artifact.payload)

    audit = result.audit_artifact.payload
    assert audit["quality_summary"]["average_score"] == 100
    assert audit["quality_summary"]["scored_chapter_count"] == 1
    assert audit["chapters"][0]["quality_score"] == 100


def test_phase9b_real_llm_smoke_fast_path_skips_semantic_judge_when_local_gate_passes(session: Session) -> None:
    """确定性与本地一致性门禁通过时，应跳过昂贵语义 Judge 并保留通过审计。"""

    _Phase9BChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Phase9BChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
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
    assert len(_Phase9BChatHandler.requests) == 1
    only_request = _Phase9BChatHandler.requests[0]
    assert "结构化一致性评审员" not in only_request["payload"]["messages"][0]["content"]

    judge = session.query(JudgeIssue).one()
    assert judge.issue_type == "phase9b_real_judge_pass"
    assert judge.payload["judge_fast_path"] == "local_gate_passed"
    assert result.book_run.progress["completed_chapters"][0]["quality_score"] == 100
    assert result.book_run.progress["completed_chapters"][0]["quality_issues"] == []


def test_phase9b_real_llm_smoke_runs_ten_chapters_with_word_targets(session: Session) -> None:
    """10 章真实 LLM 冒烟应把字数目标写入蓝图和 prompt，并产出完整 audit。"""

    _Phase9BChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Phase9BChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)

    try:
        result = run_phase9b_real_llm_smoke(
            session,
            chapter_count=10,
            token_budget=10000,
            target_word_count=50000,
            chapter_word_count_min=3000,
            chapter_word_count_max=5000,
            env=env,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 10
    assert result.book_run.total_chapters == 10
    assert result.book_run.tokens_used == 3230

    blueprint = session.query(BookBlueprint).one()
    assert blueprint.target_word_count == 50000
    assert blueprint.target_chapter_count == 10
    assert blueprint.chapter_word_count_min == 3000
    assert blueprint.chapter_word_count_max == 5000

    assert len(_Phase9BChatHandler.requests) == 20
    draft_requests = [
        item for item in _Phase9BChatHandler.requests
        if "结构化一致性评审员" not in item["payload"]["messages"][0]["content"]
    ]
    judge_requests = [
        item for item in _Phase9BChatHandler.requests
        if "结构化一致性评审员" in item["payload"]["messages"][0]["content"]
    ]
    assert len(draft_requests) == 10
    assert len(judge_requests) == 10
    assert all("3000–5000 字" in item["payload"]["messages"][-1]["content"] for item in draft_requests)
    assert all(item["headers"]["Authorization"] == "Bearer" + " test-private-credential" for item in _Phase9BChatHandler.requests)

    assert session.query(ModelRun).count() == 10
    audit = result.audit_artifact.payload
    assert len(audit["chapters"]) == 10
    assert audit["quality_summary"]["scored_chapter_count"] == 10
    assert audit["skill_chain"]["summary"]["completed_chapter_count"] == 10
    assert "test-private-credential" not in str(result.audit_artifact.payload)


def test_phase9b_real_llm_smoke_truncates_long_model_run_summaries(session: Session) -> None:
    """长程 prompt 超过 ModelRun schema 上限时，只裁剪入库摘要，不阻断运行。"""

    book = Book(title="长摘要测试", status="draft", premise="验证长程 prompt 入库摘要。")
    session.add(book)
    session.commit()
    session.refresh(book)
    blueprint = BookBlueprint(
        book_id=book.id,
        premise="验证长程 prompt 入库摘要。",
        tone="克制",
        target_word_count=35000,
        target_chapter_count=30,
        chapter_word_count_min=600,
        chapter_word_count_max=1600,
        status="locked",
        metadata_={},
    )
    session.add(blueprint)
    session.commit()
    session.refresh(blueprint)
    chapter = Chapter(book_id=book.id, ordinal=21, title="真实冒烟 21", status="approved")
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="真实 LLM 正文", status="approved", content="正文")
    session.add(scene)
    session.commit()
    session.refresh(scene)
    book_run = BookRun(
        book_id=book.id,
        blueprint_id=blueprint.id,
        status="running",
        current_chapter_index=1,
        total_chapters=30,
        progress={},
        checkpoint=[],
        token_budget=800000,
        tokens_used=0,
        chapter_budget=30,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)
    prompt = "prompt-start-" + ("甲" * 60000) + "-prompt-end"
    content = "content-start-" + ("乙" * 60000) + "-content-end"

    model_run = _record_model_run(
        session,
        book_run,
        scene,
        {
            "STORYFORGE_LLM_PROVIDER": "openai-compatible",
            "STORYFORGE_LLM_MODEL": "local-model",
        },
        {
            "prompt": prompt,
            "content": content,
            "latency_ms": 123,
            "token_usage": 456,
            "token_usage_source": "provider_usage",
        },
    )

    assert len(model_run.input_summary) <= 50000
    assert len(model_run.output_summary or "") <= 50000
    assert "prompt-start-" in model_run.input_summary
    assert "-prompt-end" in model_run.input_summary
    assert "content-start-" in (model_run.output_summary or "")
    assert "-content-end" in (model_run.output_summary or "")
    assert "摘要已截断" in model_run.input_summary
    assert model_run.payload["input_summary_original_length"] == len(prompt)
    assert model_run.payload["output_summary_original_length"] == len(content)
    assert model_run.payload["input_summary_truncated"] is True
    assert model_run.payload["output_summary_truncated"] is True


def test_phase9b_real_llm_resume_continues_after_existing_approved_chapters(session: Session) -> None:
    """断点续跑应复用已批准章节，只从下一章继续生成并导出完整证据。"""

    _Phase9BChatHandler.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Phase9BChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": _local_provider_base_url(server.server_port),
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    import os

    old_env = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    try:
        partial = run_phase9b_real_llm_smoke(
            session,
            chapter_count=2,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
            env=env,
        )
        partial.book_run.status = "running"
        partial.book_run.total_chapters = 4
        partial.book_run.chapter_budget = 4
        partial.book_run.progress = {"completed_chapters": []}
        for chapter in session.query(Chapter).order_by(Chapter.ordinal).all():
            chapter.blueprint_id = partial.book_run.blueprint_id
        session.commit()

        for ordinal in (3, 4):
            session.add(
                Chapter(
                    book_id=partial.book_run.book_id,
                    blueprint_id=partial.book_run.blueprint_id,
                    ordinal=ordinal,
                    title=f"真实冒烟 {ordinal}",
                    status="planned",
                    summary=f"第 {ordinal} 章继续推进调查。",
                    required_beats=[],
                )
            )
        session.commit()
        _Phase9BChatHandler.requests = []

        result = resume_phase9b_real_llm_smoke(
            session,
            book_run_id=partial.book_run.id,
            chapter_count=4,
            token_budget=10000,
            target_word_count=3000,
            max_chapter_count=4,
            env=env,
        )
    finally:
        server.shutdown()
        thread.join(timeout=2)
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert result.book_run.status == "completed"
    assert result.book_run.current_chapter_index == 4
    assert result.book_run.total_chapters == 4
    assert len(result.book_run.progress["completed_chapters"]) == 4
    assert [item["chapter_index"] for item in result.book_run.progress["completed_chapters"]] == [1, 2, 3, 4]
    assert [item["quality_score"] for item in result.book_run.progress["completed_chapters"][:2]] == [100, 100]
    assert session.query(ModelRun).count() == 4
    assert len(_Phase9BChatHandler.requests) == 4
    assert "第 3 章" in str(result.markdown_artifact.payload)
    assert "第 4 章" in str(result.markdown_artifact.payload)


class _FakeSession:
    def __enter__(self) -> str:
        return "fake-session"

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


def _seed_recap_chapters(session: Session, *, count: int, body_chars: int) -> int:
    book = Book(title="recap", status="draft", premise="验证有界 recap。")
    session.add(book)
    session.commit()
    session.refresh(book)
    for ordinal in range(1, count + 1):
        chapter = Chapter(
            book_id=book.id,
            ordinal=ordinal,
            title=f"第{ordinal}章",
            status="approved",
            summary=f"第{ordinal}章梗概：林岚推进调查到阶段{ordinal}。",
        )
        session.add(chapter)
        session.commit()
        session.refresh(chapter)
        scene = Scene(
            chapter_id=chapter.id,
            ordinal=1,
            title=f"第{ordinal}章正文",
            status="approved",
            content=f"CH{ordinal}_BODY_" + ("正" * body_chars),
        )
        session.add(scene)
    session.commit()
    return book.id


def test_prior_chapters_recap_is_bounded_and_keeps_recent_full_text(session: Session) -> None:
    """有界 recap：最近 N 章给完整正文，更早章节只出梗概，总长受上限约束。"""

    book_id = _seed_recap_chapters(session, count=5, body_chars=2000)

    # 为第 6 章构建上文（前 5 章已批准）。
    recap = _prior_chapters_recap(session, book_id, ordinal=6, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000

    # 最近 2 章（第 4、5 章）正文必须在内。
    assert "CH5_BODY_" in recap
    assert "CH4_BODY_" in recap
    # 更早章节（第 1-3 章）只出梗概，不出完整正文。
    assert "CH3_BODY_" not in recap
    assert "CH1_BODY_" not in recap
    assert "前情提要" in recap
    assert "第3章梗概" in recap


def test_prior_chapters_recap_length_stays_bounded_as_chapters_grow(session: Session) -> None:
    """章数从 5 增到 20 时，recap 长度仍受同一上限约束，不随章数膨胀。"""

    book_id = _seed_recap_chapters(session, count=20, body_chars=2000)
    recap = _prior_chapters_recap(session, book_id, ordinal=21, full_chapters=2, max_chars=6000)
    assert recap is not None
    assert len(recap) <= 6000


def test_prior_chapters_recap_returns_none_for_first_chapter(session: Session) -> None:
    book_id = _seed_recap_chapters(session, count=3, body_chars=50)
    assert _prior_chapters_recap(session, book_id, ordinal=1) is None



def test_phase9b_real_llm_smoke_cli_prints_summary_without_secret() -> None:
    """CLI 入口应输出可粘贴到验证报告的摘要，且不能泄露密钥。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 10
        assert token_budget == 1000
        assert target_word_count == 50000
        assert chapter_word_count_min == 3000
        assert chapter_word_count_max == 5000
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(id=7, status="completed", tokens_used=323, estimated_cost=0.0),
            markdown_artifact=SimpleNamespace(id=8, name="book.md"),
            audit_artifact=SimpleNamespace(id=9, name="audit_report.json"),
            chapter_count=10,
        )

    exit_code = main(
        [
            "--chapter-count",
            "10",
            "--token-budget",
            "1000",
            "--target-word-count",
            "50000",
            "--chapter-word-count-min",
            "3000",
            "--chapter-word-count-max",
            "5000",
        ],
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
        "chapter_count": 10,
        "tokens_used": 323,
        "estimated_cost": 0.0,
        "markdown_artifact_id": 8,
        "markdown_artifact_name": "book.md",
        "audit_artifact_id": 9,
        "audit_artifact_name": "audit_report.json",
    }
    assert error.getvalue() == ""
    assert "test-private-credential" not in output.getvalue()


def test_phase9b_real_llm_smoke_cli_writes_redacted_summary_file(tmp_path: Path) -> None:
    """CLI 应写入脱敏 summary.json，供真实 smoke 产物验收。"""

    output = StringIO()
    error = StringIO()
    summary_path = tmp_path / "summary.json"
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }
    book_md = (
        "---\n"
        "book_run_id: 11\n"
        "---\n\n"
        "# \u6d4b\u8bd5\u4e66\n\n"
        "## \u7b2c 1 \u7ae0 \u8d77\u70b9\n\n"
        "\u7b2c\u4e00\u7ae0\u6b63\u6587\n\n"
        "## \u7b2c 2 \u7ae0 \u8f6c\u6298\n\n"
        "\u7b2c\u4e8c\u7ae0\u66f4\u957f\u6b63\u6587"
    )

    def runner(
        session: str,
        *,
        chapter_count: int,
        token_budget: int,
        target_word_count: int,
        chapter_word_count_min: int,
        chapter_word_count_max: int,
        env: dict[str, str],
    ):
        assert session == "fake-session"
        assert chapter_count == 2
        assert token_budget == 60000
        assert target_word_count == 1200
        assert chapter_word_count_min == 600
        assert chapter_word_count_max == 1600
        assert env["STORYFORGE_LLM_API_KEY"] == "test-private-credential"
        return SimpleNamespace(
            book_run=SimpleNamespace(
                id=11,
                status="completed",
                tokens_used=456,
                estimated_cost=0.0,
                progress={
                    "completed_chapters": [
                        {
                            "chapter_index": 1,
                            "token_usage": 200,
                            "quality_score": 92,
                            "quality_issues": [],
                            "elapsed_time_sec": 17,
                            "repair_rounds": 0,
                        },
                        {
                            "chapter_index": 2,
                            "token_usage": 256,
                            "quality_score": 88,
                            "quality_issues": [{"summary": "需人工复核"}],
                            "elapsed_time_sec": 23,
                            "repair_rounds": 1,
                        },
                    ],
                    "budget": {"tokens_used": 456, "estimated_cost": 0.0, "elapsed_time_sec": 17},
                },
            ),
            markdown_artifact=SimpleNamespace(id=12, name="book.md", payload={"content": book_md}),
            audit_artifact=SimpleNamespace(
                id=13,
                name="audit_report.json",
                payload={"chapters": [{"chapter_index": 1}, {"chapter_index": 2}], "quality_summary": {"issue_count": 1}},
            ),
            chapter_count=2,
        )

    exit_code = main(
        [
            "--chapter-count",
            "2",
            "--token-budget",
            "60000",
            "--target-word-count",
            "1200",
            "--chapter-word-count-min",
            "600",
            "--chapter-word-count-max",
            "1600",
            "--summary-output",
            str(summary_path),
        ],
        session_factory=_FakeSession,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 0
    assert error.getvalue() == ""
    assert summary_path.exists()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["mode"] == "real_llm_smoke"
    assert summary["book_run_id"] == 11
    assert summary["book_run_status"] == "completed"
    assert summary["target_chapter_count"] == 2
    assert summary["actual_chapter_count"] == 2
    assert summary["target_word_count"] == 1200
    assert summary["chapter_word_count_min"] == 600
    assert summary["chapter_word_count_max"] == 1600
    assert summary["tokens_used"] == 456
    assert summary["estimated_cost"] == 0.0
    assert summary["actual_total_chars"] == len(book_md)
    assert summary["per_chapter_char_counts"] == [
        {"chapter_index": 1, "char_count": len("第一章正文")},
        {"chapter_index": 2, "char_count": len("第二章更长正文")},
    ]
    assert summary["markdown_artifact_id"] == 12
    assert summary["audit_artifact_id"] == 13
    assert summary["per_chapter_metrics"] == [
        {
            "chapter_index": 1,
            "token_usage": 200,
            "quality_score": 92,
            "quality_issue_count": 0,
            "elapsed_time_sec": 17,
            "repair_rounds": 0,
        },
        {
            "chapter_index": 2,
            "token_usage": 256,
            "quality_score": 88,
            "quality_issue_count": 1,
            "elapsed_time_sec": 23,
            "repair_rounds": 1,
        },
    ]
    assert summary["artifact_hashes"]["book_md_sha256"]
    assert summary["artifact_hashes"]["audit_report_sha256"]
    serialized = json.dumps(summary, ensure_ascii=False)
    assert "test-private-credential" not in serialized
    assert "provider.test" not in serialized


def test_phase9b_real_llm_smoke_cli_rejects_non_positive_target_word_count() -> None:
    """CLI 应在会话创建前拒绝非正数总字数目标。"""

    output = StringIO()
    error = StringIO()
    env = {
        "STORYFORGE_LLM_API_KEY": "test-private-credential",
        "STORYFORGE_LLM_BASE_URL": "local-provider-base",
        "STORYFORGE_LLM_MODEL": "test-real-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
    }

    def session_factory() -> _FakeSession:
        raise AssertionError("参数校验失败时不应创建数据库会话。")

    exit_code = main(
        ["--chapter-count", "10", "--token-budget", "1000", "--target-word-count", "-1"],
        session_factory=session_factory,
        output=output,
        error=error,
        env=env,
    )

    assert exit_code == 2
    assert output.getvalue() == ""
    assert "target_word_count" in error.getvalue()
    assert "test-private-credential" not in error.getvalue()


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
