from __future__ import annotations

import json

from starlette.testclient import TestClient

from app.domains.ide.book_breakdown import parse_chapters, run_book_breakdown, selected_context


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
    ]
