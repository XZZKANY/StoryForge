from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_canon_test_support import _QINGYAN, _YUER, _write_canon

from app.domains.agent_runs import (
    canon_dossier,
    canon_gate,
    canon_rebuild,
    canon_service,
    canon_store,
)
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.tooling import (
    build_loop_tool_name_map,
    build_loop_tool_schemas,
    llm_tool_name,
    loop_patch_tool_specs,
)
from app.domains.ide.command_registry import IdeCommandExecutionError, execute_ide_command_by_id

pytest_plugins = ("agent_canon_test_fixtures",)


# --- 1. 落盘 / 骨架 ---


def test_scaffold_creates_empty_canon_and_is_idempotent(project: Path) -> None:
    assert canon_store.scaffold_canon_if_missing(str(project)) is True
    canon_file = project / ".storyforge" / "canon" / "canon.json"
    assert canon_file.is_file()
    assert json.loads(canon_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "entities": [],
        "invariants": {},
    }

    # 二次调用不覆盖作者已填内容
    _write_canon(project, {"version": 1, "entities": [_QINGYAN], "invariants": {}})
    assert canon_store.scaffold_canon_if_missing(str(project)) is False
    assert canon_store.read_canon(str(project))["entities"] == [_QINGYAN]


def test_write_and_read_derived_roundtrip(project: Path) -> None:
    path = canon_store.write_derived(str(project), "presence.json", {"entities": []})
    assert Path(path).is_file()
    assert canon_store.read_derived(str(project), "presence.json") == {"entities": []}
    # 派生缓存落在 .storyforge/canon/derived 下
    assert ".storyforge" in path and "derived" in path


def test_read_canon_missing_returns_empty_skeleton(project: Path) -> None:
    assert canon_store.read_canon(str(project)) == {"version": 1, "entities": [], "invariants": {}}


# --- 2. 越界 ---


def test_derived_name_whitelist_rejects_traversal(project: Path) -> None:
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.write_derived(str(project), "../../evil.json", {})
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.read_derived(str(project), "canon.json")


def test_canon_dir_rejects_missing_root() -> None:
    with pytest.raises(FsToolError):
        canon_store.read_canon("")


# --- 3. presence 重建 ---


def test_rebuild_presence_distribution_and_chapter_order(project: Path) -> None:
    presence = canon_rebuild.rebuild_presence(str(project), [_QINGYAN, _YUER])

    by_id = {entry["id"]: entry for entry in presence["entities"]}
    qingyan = by_id["char_qingyan"]
    assert qingyan["missing"] is False
    # 第01章命中「青岩」「剑主」，第02章命中「青岩」
    assert qingyan["total_count"] == 3
    assert qingyan["first_chapter"] == 1
    assert qingyan["last_chapter"] == 2
    chapters = {occ["path"]: occ["chapter"] for occ in qingyan["occurrences"]}
    assert chapters["正文/第01章.md"] == 1
    assert chapters["正文/第02章.md"] == 2

    yuer = by_id["char_yuer"]
    assert yuer["first_chapter"] == 2 and yuer["last_chapter"] == 2


def test_rebuild_presence_marks_missing_entity(project: Path) -> None:
    ghost = {"id": "char_ghost", "canonical_name": "无名氏", "aliases": []}
    presence = canon_rebuild.rebuild_presence(str(project), [ghost])
    entry = presence["entities"][0]
    assert entry["missing"] is True
    assert entry["total_count"] == 0
    assert entry["occurrences"] == []


# --- 4. 硬矛盾 ---


def test_single_holder_overlap_is_blocking() -> None:
    canon = {
        "invariants": {
            "single_holder": [
                {"item": "断魂刀", "holder": "char_a", "from_chapter": 3, "to_chapter": 10},
                {"item": "断魂刀", "holder": "char_b", "from_chapter": 8, "to_chapter": None},
            ]
        }
    }
    result = canon_gate.check(canon, {"entities": []})
    assert result["conflict_count"] == 1
    conflict = result["conflicts"][0]
    assert conflict["category"] == "single_holder" and conflict["severity"] == "blocking"


def test_single_holder_no_overlap_is_clean() -> None:
    canon = {
        "invariants": {
            "single_holder": [
                {"item": "断魂刀", "holder": "char_a", "from_chapter": 1, "to_chapter": 5},
                {"item": "断魂刀", "holder": "char_b", "from_chapter": 6, "to_chapter": None},
            ]
        }
    }
    assert canon_gate.check(canon, {"entities": []})["conflict_count"] == 0


def test_timeline_order_cycle_is_blocking() -> None:
    canon = {
        "invariants": {
            "timeline_order": [
                {"before": "血月夜", "after": "登基大典"},
                {"before": "登基大典", "after": "决战"},
                {"before": "决战", "after": "血月夜"},
            ]
        }
    }
    result = canon_gate.check(canon, {"entities": []})
    assert result["conflict_count"] == 1
    assert result["conflicts"][0]["category"] == "timeline_order"


def test_timeline_order_acyclic_is_clean() -> None:
    canon = {
        "invariants": {
            "timeline_order": [
                {"before": "血月夜", "after": "登基大典"},
                {"before": "登基大典", "after": "决战"},
            ]
        }
    }
    assert canon_gate.check(canon, {"entities": []})["conflict_count"] == 0


# --- 5. advisory ---


def test_lifespan_reappearance_is_advisory(project: Path) -> None:
    presence = canon_rebuild.rebuild_presence(str(project), [_QINGYAN])
    canon = {
        "invariants": {
            "lifespan": [{"entity": "char_qingyan", "exits_after_chapter": 1, "reason": "阵亡"}]
        }
    }
    result = canon_gate.check(canon, presence)
    assert result["conflict_count"] == 0
    assert result["advisory_count"] == 1
    advisory = result["advisories"][0]
    assert advisory["category"] == "lifespan" and advisory["severity"] != "blocking"
    # 第02章「岩」命中，带命中章节与行号
    assert advisory["hits"] and advisory["hits"][0]["chapter"] == 2


def test_lifespan_no_reappearance_is_clean(project: Path) -> None:
    presence = canon_rebuild.rebuild_presence(str(project), [_QINGYAN])
    canon = {
        "invariants": {
            "lifespan": [{"entity": "char_qingyan", "exits_after_chapter": 5, "reason": "阵亡"}]
        }
    }
    assert canon_gate.check(canon, presence)["advisory_count"] == 0


# --- 6. 自愈（可弃缓存） ---


def test_derived_cache_is_disposable_and_rebuilds_identically(project: Path) -> None:
    first = canon_rebuild.rebuild_presence(str(project), [_QINGYAN, _YUER])
    canon_store.write_derived(str(project), "presence.json", first)

    derived_file = project / ".storyforge" / "canon" / "derived" / "presence.json"
    derived_file.unlink()
    assert canon_store.read_derived(str(project), "presence.json") is None

    second = canon_rebuild.rebuild_presence(str(project), [_QINGYAN, _YUER])
    assert second == first


# --- 7. 工具循环可见性 ---


def test_project_canon_visible_in_loop_schemas() -> None:
    schemas = build_loop_tool_schemas()
    names = {schema["function"]["name"] for schema in schemas}
    assert llm_tool_name("project.canon") in names

    name_map = build_loop_tool_name_map()
    assert name_map[llm_tool_name("project.canon")] == "project.canon"

    # 只读工具不占用「一次对话一个补丁」名额
    patch_names = {spec.name for spec in loop_patch_tool_specs()}
    assert "project.canon" not in patch_names


# --- 8. dossier 事实投影 ---


def test_build_dossiers_projects_declared_facts_and_provenance(project: Path) -> None:
    presence = canon_rebuild.rebuild_presence(str(project), [_QINGYAN, _YUER])
    canon = {
        "version": 1,
        "entities": [_QINGYAN, _YUER],
        "invariants": {
            "single_holder": [
                {"item": "断魂刀", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": None}
            ],
            "lifespan": [{"entity": "char_qingyan", "exits_after_chapter": 40, "reason": "阵亡"}],
        },
    }
    dossiers = canon_dossier.build_dossiers(canon, presence)

    # 保 canon.entities 序
    assert [d["id"] for d in dossiers] == ["char_qingyan", "char_yuer"]

    qingyan = dossiers[0]
    assert qingyan["canonical_name"] == "青岩"
    assert qingyan["aliases"] == ["剑主"]
    assert qingyan["appearance"]["missing"] is False
    assert qingyan["appearance"]["first_chapter"] == 1
    assert qingyan["appearance"]["last_chapter"] == 2
    # 绑定的声明按实体归并
    assert qingyan["holdings"] == [
        {"item": "断魂刀", "from_chapter": 1, "to_chapter": None}
    ]
    assert qingyan["lifespan"] == {"exits_after_chapter": 40, "reason": "阵亡"}
    # provenance 带文件与章节，供抽读核实
    prov_paths = {p["path"] for p in qingyan["provenance"]}
    assert prov_paths == {"正文/第01章.md", "正文/第02章.md"}
    assert qingyan["provenance_truncated"] is False

    # 未绑定声明的实体 holdings/lifespan 为空
    yuer = dossiers[1]
    assert yuer["holdings"] == []
    assert yuer["lifespan"] is None


def test_build_dossiers_marks_missing_entity(project: Path) -> None:
    ghost = {"id": "char_ghost", "canonical_name": "无名氏", "kind": "character", "aliases": []}
    presence = canon_rebuild.rebuild_presence(str(project), [ghost])
    dossiers = canon_dossier.build_dossiers(
        {"entities": [ghost], "invariants": {}}, presence
    )
    assert dossiers[0]["appearance"]["missing"] is True
    assert dossiers[0]["provenance"] == []


def test_render_dossiers_markdown_contains_facts(project: Path) -> None:
    presence = canon_rebuild.rebuild_presence(str(project), [_QINGYAN])
    canon = {
        "entities": [_QINGYAN],
        "invariants": {
            "lifespan": [{"entity": "char_qingyan", "exits_after_chapter": 40, "reason": "阵亡"}]
        },
    }
    md = canon_dossier.render_dossiers_markdown(canon_dossier.build_dossiers(canon, presence))
    assert "# Canon Dossier" in md
    assert "## 青岩" in md
    assert "剑主" in md
    assert "第 1–2 章" in md
    assert "第 40 章后退场" in md
    assert "正文/第01章.md" in md


def test_render_dossiers_markdown_empty_is_honest() -> None:
    md = canon_dossier.render_dossiers_markdown([])
    assert "尚无实体声明" in md


# --- 9. dossier.md 文本原子写 + 白名单 ---


def test_write_derived_text_roundtrip_and_whitelist(project: Path) -> None:
    path = canon_store.write_derived_text(str(project), "dossier.md", "# 测试\n")
    written = Path(path)
    assert written.is_file()
    assert written.read_text(encoding="utf-8") == "# 测试\n"
    assert ".storyforge" in path and "derived" in path
    # 文本白名单拒绝任意名 / JSON 白名单名走错通道
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.write_derived_text(str(project), "../evil.md", "x")
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.write_derived_text(str(project), "presence.json", "x")


# --- 10. 确定性投影 + canon.refresh 命令（保证写出 dossier.md）---


def test_run_canon_projection_always_writes_dossier_even_without_declarations(project: Path) -> None:
    # 真实项目：有正文，canon.json 初始为空。投影仍须写出诚实空态 dossier.md。
    output = canon_service.run_canon_projection(str(project))
    dossier = Path(output["dossier"]["path"])
    assert dossier.is_file()
    assert dossier.name == "dossier.md"
    assert output["scaffolded_canon"] is True
    assert "尚无实体声明" in dossier.read_text(encoding="utf-8")


def test_canon_refresh_command_writes_dossier_deterministically(project: Path) -> None:
    _write_canon(project, {"version": 1, "entities": [_QINGYAN, _YUER], "invariants": {}})
    result = execute_ide_command_by_id("canon.refresh", {"project_root": str(project)})

    assert result.command_id == "canon.refresh"
    canon = result.payload["canon"]
    dossier = Path(canon["dossier"]["path"])
    assert dossier.is_file()
    body = dossier.read_text(encoding="utf-8")
    assert "青岩" in body and "月儿" in body


def test_canon_refresh_command_requires_project_root() -> None:
    with pytest.raises(IdeCommandExecutionError, match="project_root"):
        execute_ide_command_by_id("canon.refresh", {})
