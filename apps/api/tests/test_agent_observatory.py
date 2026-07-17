"""observatory.scan 世界线观测镜聚合扫描：确定性、无 LLM、无 key 可验。

覆盖三路信号归一化（canon 闸 / 伏笔账 / 文笔气味）、severity 映射、稳定 id、
observations.json 派生缓存写盘、checkers 元数据诚实标注，以及 IDE 命令入口。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.agent_runs import canon_store, observatory
from app.domains.agent_runs.observatory import run_observatory_scan
from app.domains.ide.command_registry import (
    IdeCommandExecutionError,
    execute_ide_command_by_id,
)

_CLEAN_PROSE = "他推开门，握紧刀，转身，看向巷口，又停下。"
_CLICHE_PROSE = "他不禁停下脚步，心中五味杂陈。"


def _write_canon(root: Path, canon: dict) -> None:
    canon_dir = root / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)
    (canon_dir / "canon.json").write_text(json.dumps(canon, ensure_ascii=False), encoding="utf-8")


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text(_CLEAN_PROSE, encoding="utf-8")
    (tmp_path / "正文" / "第02章.md").write_text(_CLICHE_PROSE, encoding="utf-8")
    _write_canon(
        tmp_path,
        {
            "version": 1,
            "entities": [
                {"id": "char_a", "canonical_name": "青岩", "kind": "character"},
                {"id": "char_b", "canonical_name": "月儿", "kind": "character"},
            ],
            "invariants": {
                "single_holder": [
                    {"item": "断魂刀", "holder": "char_a", "from_chapter": 1, "to_chapter": 10},
                    {"item": "断魂刀", "holder": "char_b", "from_chapter": 5, "to_chapter": 8},
                ],
                "promises": [
                    {
                        "id": "p1",
                        "title": "旧钟",
                        "kind": "foreshadow",
                        "status": "planted",
                        "planted_chapter": 1,
                        "due_chapter": 1,
                        "touches": [1],
                    }
                ],
            },
        },
    )
    return tmp_path


# --- 1. 三路信号归一化 + 写盘 ---


def test_scan_normalizes_three_sources_and_persists(project: Path) -> None:
    payload = run_observatory_scan(str(project))

    by_source = {obs["source"]: obs for obs in payload["observations"]}
    canon_obs = by_source["canon·single_holder"]
    assert canon_obs["severity"] == "error"  # blocking → error
    assert canon_obs["id"].startswith("canon_")
    assert canon_obs["location"] == {"path": ".storyforge/canon/canon.json"}
    assert "断魂刀" in canon_obs["title"]

    promise_obs = by_source["promise·overdue"]
    assert promise_obs["severity"] == "warning"  # medium → warning
    assert promise_obs["id"].startswith("promise_")
    assert "旧钟" in promise_obs["title"]

    prose_obs = by_source["prose·套话"]
    assert prose_obs["severity"] == "warning"  # 中 → warning
    assert prose_obs["id"].startswith("prose_")
    assert prose_obs["location"]["path"] == "正文/第02章.md"
    assert prose_obs["location"]["snippet"]

    assert payload["counts"] == {"error": 1, "warning": 2, "advisory": 0, "total": 3}

    persisted = canon_store.read_derived(str(project), "observations.json")
    assert persisted is not None
    assert persisted["observations"] == payload["observations"]
    assert persisted["counts"] == payload["counts"]


def test_checkers_metadata_marks_ran_and_on_demand(project: Path) -> None:
    payload = run_observatory_scan(str(project))

    status_by_key = {item["key"]: item["status"] for item in payload["checkers"]}
    assert status_by_key == {
        "canon": "ran",
        "promise": "ran",
        "prose": "ran",
        "consistency": "on_demand",
        "collapse": "on_demand",
        "entity_budget": "on_demand",
        "deep_consistency": "on_demand",
    }
    on_demand = [item for item in payload["checkers"] if item["status"] == "on_demand"]
    assert all(item.get("reason") for item in on_demand)


# --- 2. id 稳定性（前端按 id 去重 / 记忆已处理态的前提） ---


def test_observation_ids_stable_across_runs(project: Path) -> None:
    first = run_observatory_scan(str(project))
    second = run_observatory_scan(str(project))

    assert [obs["id"] for obs in first["observations"]] == [obs["id"] for obs in second["observations"]]
    assert first["observations"] == second["observations"]


# --- 3. 边界：空文件跳过 / 无声明项目 / 文件数上限 ---


def test_scan_skips_empty_markdown_files(project: Path) -> None:
    (project / "正文" / "空.md").write_text("   \n\n  ", encoding="utf-8")

    payload = run_observatory_scan(str(project))

    prose_checker = next(item for item in payload["checkers"] if item["key"] == "prose")
    assert prose_checker["files_skipped"] == 1
    assert prose_checker["files_scanned"] == 2


def test_scan_without_declarations_yields_empty_observations(tmp_path: Path) -> None:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text(_CLEAN_PROSE, encoding="utf-8")

    payload = run_observatory_scan(str(tmp_path))

    assert payload["observations"] == []
    assert payload["counts"]["total"] == 0
    assert canon_store.read_derived(str(tmp_path), "observations.json") is not None


def test_prose_file_cap_marks_truncated(project: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(observatory, "_MAX_PROSE_FILES", 1)

    payload = run_observatory_scan(str(project))

    prose_checker = next(item for item in payload["checkers"] if item["key"] == "prose")
    assert prose_checker["files_truncated"] is True
    assert prose_checker["files_scanned"] == 1


# --- 4. 结构化台账（payload v2：观测镜富 view 数据源——实体 / 伏笔 / 提案） ---


def test_entities_section_projects_dossier_with_related_observations(project: Path) -> None:
    payload = run_observatory_scan(str(project))

    assert payload["version"] == 2
    entities = {entry["id"]: entry for entry in payload["entities"]}
    assert set(entities) == {"char_a", "char_b"}
    conflict_id = next(
        obs["id"] for obs in payload["observations"] if obs["source"] == "canon·single_holder"
    )
    assert entities["char_a"]["related_observation_ids"] == [conflict_id]
    assert entities["char_b"]["related_observation_ids"] == [conflict_id]
    assert entities["char_a"]["canonical_name"] == "青岩"
    assert entities["char_a"]["holdings"] == [
        {"item": "断魂刀", "from_chapter": 1, "to_chapter": 10}
    ]
    # 正文未出现声明实体的表面形 → appearance 如实 missing，不伪造出场。
    assert entities["char_a"]["appearance"]["missing"] is True


def test_promises_section_builds_ledger_with_issues(project: Path) -> None:
    payload = run_observatory_scan(str(project))

    promises = payload["promises"]
    assert promises["current_chapter"] == 2
    ledger = {entry["id"]: entry for entry in promises["ledger"]}
    assert set(ledger) == {"p1"}
    entry = ledger["p1"]
    assert entry["title"] == "旧钟"
    assert entry["status"] == "planted"
    assert entry["planted_chapter"] == 1
    assert entry["due_chapter"] == 1
    assert [issue["category"] for issue in entry["issues"]] == ["overdue"]
    assert entry["issues"][0]["id"].startswith("promise_")


def test_proposals_section_absent_cache_reports_unavailable(project: Path) -> None:
    payload = run_observatory_scan(str(project))

    assert payload["proposals"] == {
        "available": False,
        "new_entities": [],
        "new_invariants": {},
        "pending_count": 0,
    }


def test_proposals_section_diffs_draft_against_canon(project: Path) -> None:
    canon = canon_store.read_canon(str(project))
    draft = json.loads(json.dumps(canon))
    draft["entities"].append(
        {"id": "item_lamp", "canonical_name": "铜灯", "aliases": ["提灯"]}
    )
    draft["invariants"].setdefault("lifespan", []).append(
        {"entity": "char_b", "exits_after_chapter": 9}
    )
    canon_store.write_derived(str(project), "proposals.json", draft)

    payload = run_observatory_scan(str(project))

    proposals = payload["proposals"]
    assert proposals["available"] is True
    assert [entity["id"] for entity in proposals["new_entities"]] == ["item_lamp"]
    assert proposals["new_invariants"] == {
        "lifespan": [{"entity": "char_b", "exits_after_chapter": 9}]
    }
    assert proposals["pending_count"] == 2


def test_proposals_already_merged_disappear_from_pending(project: Path) -> None:
    # 作者把草稿并入 canon 后差集自愈清空，提案不会重复出现。
    canon = canon_store.read_canon(str(project))
    canon_store.write_derived(str(project), "proposals.json", canon)

    payload = run_observatory_scan(str(project))

    assert payload["proposals"]["available"] is True
    assert payload["proposals"]["pending_count"] == 0
    assert payload["proposals"]["new_entities"] == []
    assert payload["proposals"]["new_invariants"] == {}


# --- 5. IDE 命令入口（与 canon.refresh 同模式：writes=False，确定性无 LLM） ---


def test_ide_command_observatory_scan_roundtrip(project: Path) -> None:
    result = execute_ide_command_by_id("observatory.scan", {"project_root": str(project)})

    assert result.command_id == "observatory.scan"
    assert result.status == "accepted"
    observatory_payload = result.payload["observatory"]
    assert observatory_payload["counts"]["total"] == 3


def test_ide_command_observatory_scan_requires_project_root() -> None:
    with pytest.raises(IdeCommandExecutionError):
        execute_ide_command_by_id("observatory.scan", {})
