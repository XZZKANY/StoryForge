from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.agent_runs.fs import (
    FsToolError,
    project_knowledge_candidates,
    project_knowledge_read,
    project_knowledge_search,
)
from app.domains.agent_runs.runtime import AgentRuntime


def _write(root: Path, relative: str, content: str = "资料内容") -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def test_project_knowledge_candidates_are_allowlisted_and_stable(tmp_path: Path) -> None:
    expected = {
        ".storyforge/agent-instructions.md": "author_instructions",
        ".storyforge/book.json": "book_profile",
        ".storyforge/canon/canon.json": "canon",
        ".storyforge/canon/hooks.json": "canon",
        ".storyforge/serial-plan.json": "serial_plan",
        ".资料/黄金三章spec.md": "materials",
        "人物/主角.md": "character",
        "大纲/总纲.md": "outline",
        "时间线/年表.yaml": "timeline",
        "资料/playbook.txt": "materials",
        "设定/世界.json": "setting",
    }
    for relative in expected:
        _write(tmp_path, relative, json.dumps({"path": relative}, ensure_ascii=False))

    for relative in (
        ".env",
        ".secret/notes.md",
        ".storyforge/config.json",
        ".storyforge/credentials.json",
        ".storyforge/versions/v1.md",
        ".storyforge/canon/derived/cache.json",
        ".storyforge/cache/summary.md",
        ".unknown/notes.md",
        "资料/access-token.md",
        "资料/config/internal.md",
        "资料/secrets/notes.md",
        "资料/archive.bin",
        "正文/第001章.md",
    ):
        _write(tmp_path, relative)

    entries = project_knowledge_candidates(str(tmp_path))

    assert [item["path"] for item in entries] == sorted(expected)
    assert {item["path"]: item["source_type"] for item in entries} == expected
    assert all(set(item) == {"path", "title", "source_type", "size_bytes"} for item in entries)


def test_project_knowledge_read_revalidates_path_and_redacts_secrets(tmp_path: Path) -> None:
    _write(tmp_path, ".资料/规则.md", "API_KEY=sk-projectknowledge-secret\n必须用第三人称")
    _write(tmp_path, ".storyforge/config.json", '{"provider": "internal"}')

    result = project_knowledge_read(str(tmp_path), ".资料/规则.md")

    assert result["path"] == ".资料/规则.md"
    assert result["source_type"] == "materials"
    assert "sk-projectknowledge-secret" not in result["content"]
    assert "[REDACTED]" in result["content"]
    assert result["redacted"] is True
    assert result["warnings"]

    for path in (".storyforge/config.json", "../outside.md", "file:///outside.md"):
        with pytest.raises(FsToolError):
            project_knowledge_read(str(tmp_path), path)


def test_project_knowledge_rejects_oversize_and_symlink_escape(tmp_path: Path) -> None:
    _write(tmp_path, "资料/too-large.md", "x" * (512 * 1024 + 1))
    outside = tmp_path.parent / "outside-knowledge.md"
    outside.write_text("outside", encoding="utf-8")
    link = tmp_path / "资料" / "link.md"
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("当前环境不允许创建符号链接")

    assert project_knowledge_candidates(str(tmp_path)) == []
    with pytest.raises(FsToolError):
        project_knowledge_read(str(tmp_path), "资料/too-large.md")
    with pytest.raises(FsToolError):
        project_knowledge_read(str(tmp_path), "资料/link.md")


def test_project_knowledge_search_only_scans_eligible_files(tmp_path: Path) -> None:
    _write(tmp_path, ".资料/黄金三章spec.md", "开篇必须出现不可逆选择")
    _write(tmp_path, ".storyforge/versions/old.md", "不可逆选择")
    _write(tmp_path, "正文/第001章.md", "不可逆选择")

    result = project_knowledge_search(str(tmp_path), "不可逆选择")

    assert [match["path"] for match in result["matches"]] == [".资料/黄金三章spec.md"]
    assert result["scanned_files"] == 1


def test_project_knowledge_search_scans_past_the_read_slice_limit(tmp_path: Path) -> None:
    _write(tmp_path, "资料/长规则.md", f"{'x' * 210_000}\n后半段哨兵")

    result = project_knowledge_search(str(tmp_path), "后半段哨兵")

    assert result["matches"] == [
        {
            "path": "资料/长规则.md",
            "source_type": "materials",
            "line": 2,
            "excerpt": "后半段哨兵",
        }
    ]


def test_project_knowledge_runtime_trace_contains_only_safe_metadata(tmp_path: Path) -> None:
    _write(tmp_path, ".资料/规则.md", "API_KEY=sk-projectknowledge-secret\n不可逆选择")
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]

    result = runtime._project_knowledge(  # noqa: SLF001 - runtime behavior seam
        None,  # type: ignore[arg-type]
        {"project_root": str(tmp_path), "action": "read", "path": ".资料/规则.md"},
    )

    assert result.output["redacted"] is True
    assert result.trace is not None
    encoded_trace = json.dumps(result.trace.as_dict(), ensure_ascii=False, sort_keys=True)
    assert ".资料/规则.md" in encoded_trace
    assert str(tmp_path) not in encoded_trace
    assert "不可逆选择" not in encoded_trace
    assert "sk-projectknowledge-secret" not in encoded_trace
