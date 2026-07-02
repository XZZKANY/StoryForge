from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.consistency_scan import consistency_scan
from app.domains.agent_runs.fs_tools import FsToolError


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "设定").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text(
        "沈青梧登上观星台。\n次日清晨，沈青梧又来了。\n他掏出怀里的铜镜看了一眼。\n他掏出怀里的铜镜看了一眼。\n",
        encoding="utf-8",
    )
    (tmp_path / "正文" / "第02章.md").write_text(
        "三日后，黄昏。\n他掏出怀里的铜镜看了一眼。\n沈青梧沉默不语。\n",
        encoding="utf-8",
    )
    (tmp_path / "设定" / "人物.md").write_text("沈青梧：钦天监灵台郎。\n", encoding="utf-8")
    return tmp_path


def test_term_occurrences_with_counts_lines_and_missing(project: Path) -> None:
    output = consistency_scan(str(project), ["沈青梧", "裴砚"])

    by_term = {entry["term"]: entry for entry in output["term_occurrences"]}
    shen = by_term["沈青梧"]
    assert shen["total_count"] == 4
    assert shen["missing"] is False
    by_path = {entry["path"]: entry for entry in shen["files"]}
    assert by_path["正文/第01章.md"]["count"] == 2
    assert by_path["正文/第01章.md"]["first_line"] == 1
    assert by_path["正文/第01章.md"]["last_line"] == 2
    assert by_path["正文/第02章.md"]["count"] == 1
    assert by_path["设定/人物.md"]["count"] == 1

    pei = by_term["裴砚"]
    assert pei["missing"] is True
    assert pei["total_count"] == 0
    assert pei["files"] == []


def test_time_markers_in_reading_order_with_excerpts(project: Path) -> None:
    output = consistency_scan(str(project))

    markers = [(entry["path"], entry["marker"]) for entry in output["time_markers"]]
    assert markers == [
        ("正文/第01章.md", "次日"),
        ("正文/第01章.md", "清晨"),
        ("正文/第02章.md", "三日后"),
        ("正文/第02章.md", "黄昏"),
    ]
    first = output["time_markers"][0]
    assert first["line"] == 2
    assert "次日清晨" in first["excerpt"]


def test_repeated_clauses_across_files_above_threshold(project: Path) -> None:
    output = consistency_scan(str(project))

    clauses = {entry["clause"]: entry for entry in output["repeated_clauses"]}
    repeated = clauses["他掏出怀里的铜镜看了一眼"]
    assert repeated["count"] == 3
    assert repeated["files"] == ["正文/第01章.md", "正文/第02章.md"]
    # 只出现 1-2 次的子句不进入重复列表
    assert "沈青梧登上观星台" not in clauses


def test_subpath_and_glob_scope(project: Path) -> None:
    scoped = consistency_scan(str(project), ["沈青梧"], subpath="正文")
    assert scoped["scanned_files"] == 2
    by_term = {entry["term"]: entry for entry in scoped["term_occurrences"]}
    assert by_term["沈青梧"]["total_count"] == 3

    globbed = consistency_scan(str(project), ["沈青梧"], glob="人物.md")
    assert globbed["scanned_files"] == 1
    assert globbed["term_occurrences"][0]["total_count"] == 1


def test_path_escape_rejected(project: Path) -> None:
    with pytest.raises(FsToolError, match="路径越界"):
        consistency_scan(str(project), subpath="../外面")


def test_terms_deduped_and_capped(project: Path) -> None:
    terms = ["沈青梧", "沈青梧", " "] + [f"词条{index}" for index in range(40)]
    output = consistency_scan(str(project), terms)

    tracked = [entry["term"] for entry in output["term_occurrences"]]
    assert len(tracked) == 30
    assert tracked[0] == "沈青梧"
    assert len(set(tracked)) == 30
    assert output["terms_truncated"] is True


def test_binary_file_skipped(project: Path) -> None:
    (project / "正文" / "坏文件.md").write_bytes(b"\x00\x01\x02damaged")

    output = consistency_scan(str(project))

    assert output["scanned_files"] == 3
