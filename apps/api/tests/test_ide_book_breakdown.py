from __future__ import annotations

import json
import threading

import pytest
from starlette.testclient import TestClient

import app.domains.ide.book_breakdown as breakdown
from app.domains.ide.book_breakdown import (
    parse_chapters,
    prepare_breakdown_cancellation,
    read_book_breakdown_status,
    run_book_breakdown,
    selected_context,
)


def test_parse_chapters_falls_back_to_single_chapter() -> None:
    chapters = parse_chapters("这是一段没有章节标题的参考文本。", "参考.txt")

    assert len(chapters) == 1
    assert chapters[0]["degraded_single_chapter"] is True
    assert chapters[0]["chapter_id"] == "参考.txt:1"


def test_book_breakdown_writes_versioned_report_and_bounded_context(tmp_path) -> None:
    source = tmp_path / "参考.md"
    source.write_text(
        "\n".join(
            [
                "# 第一章 开端",
                "主角在雨夜收到一封信。",
                "# 第二章 追踪",
                "他沿着线索进入旧城。",
                "# 第三章 冲突",
                "对手出现，交易被迫中断。",
                "# 第四章 反转",
                "看似盟友的人交出了另一份证据。",
                "# 第五章 余波",
                "主角决定回到港口。",
            ]
        ),
        encoding="utf-8",
    )

    report = run_book_breakdown(str(tmp_path), target_count=3)

    assert report["status"] == "completed_deterministic"
    assert report["schema_version"] == "storyforge.breakdown.v1"
    assert len(report["selected_chapters"]) == 3
    assert set(report["analysis"]) == {
        "story_structure",
        "characters_and_relations",
        "conflict_and_rhythm",
        "setting_and_world",
        "craft_methods",
        "transferable_insights",
    }
    report_path = tmp_path / ".storyforge" / "analysis" / "book-breakdown.json"
    assert report_path.is_file()
    persisted = json.loads(report_path.read_text(encoding="utf-8"))
    assert persisted["input_sha256"] == report["input_sha256"]

    context = selected_context(str(tmp_path), report, max_chars=500)
    assert "结构锚点" in context
    assert len(context) <= 500


def test_book_breakdown_ide_command_records_report_artifact(client: TestClient, tmp_path) -> None:
    (tmp_path / "正文.txt").write_text("第1章\n开端\n第2章\n冲突", encoding="utf-8")

    response = client.post(
        "/api/ide/commands/book.breakdown",
        json={"args": {"project_root": str(tmp_path), "target_count": 3}},
    )

    assert response.status_code == 200, response.text
    payload = response.json()["payload"]["breakdown"]
    assert payload["status"] == "completed_deterministic"
    assert payload["run_id"].startswith("breakdown-")
    assert isinstance(payload["artifact_id"], int)
    assert payload["paths"] == [
        ".storyforge/analysis/book-breakdown.json",
        ".storyforge/analysis/chapters.json",
        ".storyforge/analysis/selection.json",
        ".storyforge/analysis/book-breakdown.md",
    ]


def test_book_breakdown_status_detects_source_drift(tmp_path) -> None:
    source = tmp_path / "正文.txt"
    source.write_text("第1章\n开端\n第2章\n冲突", encoding="utf-8")
    run_book_breakdown(str(tmp_path), target_count=3)

    fresh = read_book_breakdown_status(str(tmp_path))
    assert fresh["stale"] is False
    source.write_text("第1章\n开端已修改\n第2章\n冲突", encoding="utf-8")
    stale = read_book_breakdown_status(str(tmp_path))
    assert stale["status"] == "stale"
    assert stale["stale"] is True


def test_book_breakdown_status_ide_command_is_read_only(client: TestClient, tmp_path) -> None:
    (tmp_path / "正文.txt").write_text("第1章\n开端\n第2章\n冲突", encoding="utf-8")
    run_book_breakdown(str(tmp_path), target_count=3)
    response = client.post(
        "/api/ide/commands/book.breakdown.status",
        json={"args": {"project_root": str(tmp_path)}},
    )
    assert response.status_code == 200, response.text
    payload = response.json()["payload"]["breakdown"]
    assert payload["stale"] is False


def test_book_breakdown_cancel_command_sets_pending_event(client: TestClient) -> None:
    prepare_breakdown_cancellation("pending-run")
    response = client.post(
        "/api/ide/commands/book.breakdown.cancel",
        json={"args": {"analysis_id": "pending-run"}},
    )

    assert response.status_code == 200, response.text
    assert response.json()["payload"]["breakdown"]["cancellation_requested"] is True


def test_book_breakdown_model_malformed_json_preserves_deterministic_report(monkeypatch, tmp_path) -> None:
    (tmp_path / "正文.md").write_text("# 第一章\n开端\n# 第二章\n冲突\n# 第三章\n反转", encoding="utf-8")

    def fake_call(_source, *, system_prompt, user_prompt):
        return {"content": "不是 JSON"}

    monkeypatch.setattr(breakdown, "_call_llm", fake_call)
    report = run_book_breakdown(
        str(tmp_path),
        target_count=3,
        model_source={"STORYFORGE_LLM_PROVIDER": "deterministic", "STORYFORGE_LLM_MODEL": "test-model"},
    )

    assert report["status"] == "completed_deterministic"
    assert report["model_error"] == "structured_analysis_failed"
    assert len(report["selected_chapters"]) == 3


def test_book_breakdown_cancellation_persists_cancelled_partial_report(tmp_path) -> None:
    (tmp_path / "正文.txt").write_text("第1章\n开端\n第2章\n冲突", encoding="utf-8")
    cancel_event = threading.Event()
    cancel_event.set()

    report = breakdown.run_book_breakdown(
        str(tmp_path), target_count=3, analysis_id="cancelled-run", cancel_event=cancel_event
    )

    assert report["status"] == "cancelled"
    persisted = json.loads(
        (tmp_path / ".storyforge" / "analysis" / "book-breakdown.json").read_text(encoding="utf-8")
    )
    assert persisted["status"] == "cancelled"


def test_book_breakdown_persistence_failure_is_explicit(monkeypatch, tmp_path) -> None:
    (tmp_path / "正文.txt").write_text("第1章\n开端", encoding="utf-8")

    def fail_write(*_args, **_kwargs):
        raise OSError("磁盘写入失败")

    monkeypatch.setattr(breakdown, "atomic_write_json", fail_write)
    with pytest.raises(OSError, match="磁盘写入失败"):
        run_book_breakdown(str(tmp_path), target_count=3)


def test_book_breakdown_uses_configured_model_and_validates_structured_output(monkeypatch, tmp_path) -> None:
    (tmp_path / "正文.md").write_text("# 第一章\n开端\n# 第二章\n冲突\n# 第三章\n反转", encoding="utf-8")
    calls: list[str] = []

    def fake_call(_source, *, system_prompt, user_prompt):
        calls.append(user_prompt)
        return {"content": json.dumps({key: {"summary": f"{key} 的可迁移观察"} for key in breakdown._ANALYSIS_KEYS}, ensure_ascii=False)}

    monkeypatch.setattr(breakdown, "_call_llm", fake_call)
    report = breakdown.run_book_breakdown(
        str(tmp_path),
        target_count=3,
        model_source={"STORYFORGE_LLM_PROVIDER": "deterministic", "STORYFORGE_LLM_MODEL": "test-model"},
    )

    assert report["status"] == "completed"
    assert report["model"] == "test-model"
    assert report["provider"] == "deterministic"
    assert len(calls) == 1
    assert all(item["status"] == "completed" for item in report["analysis"].values())
