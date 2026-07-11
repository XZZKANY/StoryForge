from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.agent_runs import (
    canon_context,
    canon_dossier,
    canon_gate,
    canon_hooks_delta,
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

# 表面形刻意互不为子串（真实别名多为独立称谓 / 头衔），避免嵌套子串重复计数。
_QINGYAN = {
    "id": "char_qingyan",
    "canonical_name": "青岩",
    "kind": "character",
    "aliases": ["剑主"],
}
_YUER = {"id": "char_yuer", "canonical_name": "月儿", "kind": "character", "aliases": []}


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text(
        "青岩踏入观星台。\n剑主握紧断魂刀。\n", encoding="utf-8"
    )
    (tmp_path / "正文" / "第02章.md").write_text(
        "月儿远远望着。\n青岩转身离去。\n", encoding="utf-8"
    )
    return tmp_path


def _write_canon(root: Path, canon: dict) -> None:
    canon_dir = root / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)
    (canon_dir / "canon.json").write_text(json.dumps(canon, ensure_ascii=False), encoding="utf-8")


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


# --- 11. 场景约束头 push（确定性，无 LLM）---


def test_scene_constraint_block_lifespan_after_exit(project: Path) -> None:
    """角色已退场 → 编辑退场后章节时推硬约束，堵「死人复活」漂移。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "lifespan": [
                    {"entity": "char_qingyan", "exits_after_chapter": 1, "reason": "阵亡"}
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "青岩" in block
    assert "已于第 1 章退场" in block
    assert "阵亡" in block
    assert "回忆 / 提及" in block
    assert "本文件 = 第 2 章" in block


def test_scene_constraint_block_lifespan_before_exit(project: Path) -> None:
    """角色尚未退场 → 编辑退场前章节时不推 lifespan 约束。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "lifespan": [
                    {"entity": "char_qingyan", "exits_after_chapter": 5, "reason": "阵亡"}
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第01章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    # 退场章(5) ≥ 当前章(1)，不应推 lifespan——她还活着。
    assert block is None or "退场" not in block


def test_scene_constraint_block_single_holder_window_covers(project: Path) -> None:
    """唯一持有章窗覆盖当前章 → 推硬约束。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "归零权限", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": None}
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "归零权限" in block
    assert "唯一持有者" in block
    assert "char_qingyan" in block
    assert "不得出现第二持有者" in block


def test_scene_constraint_block_single_holder_window_miss(project: Path) -> None:
    """唯一持有章窗不覆盖当前章 → 不推对应约束。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "断魂刀", "holder": "char_a", "from_chapter": 8, "to_chapter": 10}
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is None or "断魂刀" not in block


def test_scene_constraint_block_empty_canon_returns_none(project: Path) -> None:
    """无声明 canon → 不推约束头、不占上下文。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    current_file = str(project / "正文" / "第02章.md")
    assert canon_context.build_scene_constraint_block(str(project), current_file) is None


def test_scene_constraint_block_missing_canon_returns_none(project: Path) -> None:
    """无 canon.json → 静默 None，不拖垮聊天循环。"""
    current_file = str(project / "正文" / "第02章.md")
    assert canon_context.build_scene_constraint_block(str(project), current_file) is None


def test_scene_constraint_block_no_current_file_pushes_whole_book(project: Path) -> None:
    """无当前文件 → 全书模式：全量推 lifespan + single_holder，不推章序锚。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "lifespan": [
                    {"entity": "char_qingyan", "exits_after_chapter": 1, "reason": "阵亡"}
                ],
                "single_holder": [
                    {"item": "归零权限", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": None}
                ],
            },
        },
    )
    block = canon_context.build_scene_constraint_block(str(project), None)
    assert block is not None
    assert "青岩" in block
    assert "于第 1 章退场" in block
    assert "归零权限" in block
    assert "全书" in block
    assert "本文件" not in block


def test_scene_constraint_block_current_file_outside_project_is_safe(project: Path) -> None:
    """当前文件越界 → 静默退化为全书模式，不崩。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [],
            "invariants": {
                "single_holder": [
                    {"item": "归零权限", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": None}
                ]
            },
        },
    )
    block = canon_context.build_scene_constraint_block(str(project), "/tmp/outside.md")
    assert block is not None
    assert "归零权限" in block
    assert "本文件" not in block  # 章序锚不出现


def test_scene_constraint_block_lifespan_display_uses_canonical_name(project: Path) -> None:
    """lifespan.entity 是 id 时显示 canonical_name，无映射回落 id。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "lifespan": [
                    {"entity": "char_yuer", "exits_after_chapter": 1, "reason": "失踪"}
                ]
            },
        },
    )
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    # char_yuer 不在 entities 中 → 回落 id
    assert "char_yuer" in block
    # char_qingyan 在 entities 中但 lifespan 没声明它 → 不出现
    assert "青岩" not in block


# --- 12. 伏笔 hooks push（确定性，无 LLM）---


def _write_hooks(root: Path, hooks: list[dict]) -> None:
    canon_store.write_hooks(str(root), {"version": 1, "hooks": hooks})


def test_hooks_scaffold_creates_empty_and_is_idempotent(project: Path) -> None:
    assert canon_store.scaffold_hooks_if_missing(str(project)) is True
    hooks_file = project / ".storyforge" / "canon" / "hooks.json"
    assert hooks_file.is_file()
    assert canon_store.read_hooks(str(project)) == {"version": 1, "hooks": []}

    _write_hooks(project, [{"id": "h1", "description": "test", "status": "active"}])
    assert canon_store.scaffold_hooks_if_missing(str(project)) is False
    assert len(canon_store.read_hooks(str(project))["hooks"]) == 1


def test_hooks_read_and_write_roundtrip(project: Path) -> None:
    hooks = [
        {
            "id": "hook_sword",
            "description": "青岩欠陆沉一把刀的情",
            "verification": "后续出现青岩为陆沉出手或还刀",
            "status": "active",
            "planted_at": {"chapter": 3, "path": "正文/第03章.md"},
            "category": "character_debt",
        }
    ]
    _write_hooks(project, hooks)
    assert canon_store.read_hooks(str(project))["hooks"] == hooks


def test_hooks_missing_returns_empty_skeleton(project: Path) -> None:
    assert canon_store.read_hooks(str(project)) == {"version": 1, "hooks": []}


def test_build_active_hooks_in_constraint_block(project: Path) -> None:
    """活跃钩子出现在约束头中。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [
            {
                "id": "hook_sword",
                "description": "青岩欠陆沉一把刀的情",
                "status": "active",
                "planted_at": {"chapter": 3},
                "category": "character_debt",
            },
            {
                "id": "hook_coin",
                "description": "系统积分达 10 万触发不可逆事件",
                "status": "active",
                "planted_at": {"chapter": 5},
                "category": "threshold",
            },
        ],
    )
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "活跃伏笔" in block
    assert "青岩欠陆沉" in block
    assert "第 3 章埋" in block
    assert "character_debt" in block
    assert "积分达 10 万" in block
    assert "threshold" in block


def test_build_active_hooks_excludes_resolved_hooks(project: Path) -> None:
    """已回收钩子不出现在约束头中。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [
            {
                "id": "hook_old",
                "description": "已回收的伏笔",
                "status": "resolved",
                "planted_at": {"chapter": 2},
            },
            {
                "id": "hook_alive",
                "description": "仍在活跃的伏笔",
                "status": "active",
                "planted_at": {"chapter": 4},
            },
        ],
    )
    current_file = str(project / "正文" / "第04章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "仍在活跃" in block
    assert "已回收" not in block


def test_build_active_hooks_no_hooks_file_returns_clean(project: Path) -> None:
    """无 hooks.json → 不拖垮循环，constraint block 正常返回。"""
    _write_canon(
        project,
        {
            "version": 1,
            "entities": [_QINGYAN],
            "invariants": {
                "lifespan": [
                    {"entity": "char_qingyan", "exits_after_chapter": 1, "reason": "阵亡"}
                ]
            },
        },
    )
    # 不写 hooks.json
    current_file = str(project / "正文" / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "青岩" in block
    assert "活跃伏笔" not in block


def test_build_active_hooks_empty_hooks_returns_clean(project: Path) -> None:
    """hooks.json 空 → 不推伏笔块。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(project, [])
    block = canon_context.build_scene_constraint_block(str(project), None)
    assert block is None  # no canon invariants + no hooks = no block at all


def test_build_active_hooks_appends_note(project: Path) -> None:
    """hook 带 note → 在行尾展示（含破折号前缀）。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [
            {
                "id": "hook_note",
                "description": "暗影组织首领身份未揭",
                "status": "active",
                "planted_at": {"chapter": 1},
                "note": "建议第 10 章前后揭示",
                "category": "mystery",
            }
        ],
    )
    block = canon_context.build_scene_constraint_block(str(project), None)
    assert block is not None
    assert "暗影组织" in block
    assert "建议第 10 章前后揭示" in block


# --- 13. hooks_delta 确定性归并 ---


def test_hooks_delta_new_hooks_proposed(project: Path) -> None:
    """观测到新钩子 → 返回 new_hooks。"""
    _write_hooks(project, [])
    result = canon_hooks_delta.hooks_delta(
        str(project),
        observed_hooks=[
            {"description": "青岩欠陆沉一把刀的情", "category": "character_debt"},
            {"description": "系统积分达 10 万触发不可逆事件", "category": "threshold"},
        ],
    )
    assert len(result["new_hooks"]) == 2
    assert result["duplicates"] == []
    assert "检测到 2 条新钩子" in result["summary"]


def test_hooks_delta_deduplicates_description_substring(project: Path) -> None:
    """描述子串重叠 → 标记为重复。"""
    _write_hooks(
        project,
        [
            {
                "id": "h1",
                "description": "青岩欠陆沉一把刀的情",
                "status": "active",
                "category": "character_debt",
            }
        ],
    )
    result = canon_hooks_delta.hooks_delta(
        str(project),
        observed_hooks=[
            {"description": "青岩欠陆沉一把刀的情"},
            {"description": "全新的伏笔"},
        ],
    )
    assert len(result["new_hooks"]) == 1
    assert result["new_hooks"][0]["description"] == "全新的伏笔"
    assert len(result["duplicates"]) == 1


def test_hooks_delta_pattern_matches_evidence_text(project: Path) -> None:
    """evidence_text 中有倒计时 → pattern_hits 含 countdown。"""
    _write_hooks(project, [])
    result = canon_hooks_delta.hooks_delta(
        str(project),
        evidence_text="陆沉看了一眼倒计时：还剩 7 天。如果不能突破，一切就结束了。",
    )
    assert len(result["pattern_hits"]) >= 1
    categories = {h["category"] for h in result["pattern_hits"]}
    assert "countdown" in categories
    assert len(result["new_hooks"]) == 0  # 无 LLM 观测时新钩子为空


def test_hooks_delta_empty_observation_returns_clean(project: Path) -> None:
    """无观测无证据 → 空结果。"""
    _write_hooks(project, [])
    result = canon_hooks_delta.hooks_delta(str(project))
    assert result["new_hooks"] == []
    assert result["duplicates"] == []
    assert result["pattern_hits"] == []
    assert "未发现" in result["summary"]


def test_hooks_delta_invalid_parameter_rejects(project: Path) -> None:
    """description 缺失 → 抛 FsToolError。"""
    from app.domains.agent_runs.fs_tools import FsToolError

    _write_hooks(project, [])
    with pytest.raises(FsToolError, match="description"):
        canon_hooks_delta.hooks_delta(
            str(project),
            observed_hooks=[{"category": "oath"}],
        )


def test_hooks_delta_partial_parameter_is_valid(project: Path) -> None:
    """只传 description → 合法。"""
    _write_hooks(project, [])
    result = canon_hooks_delta.hooks_delta(
        str(project),
        observed_hooks=[{"description": "谜团待解"}],
    )
    assert len(result["new_hooks"]) == 1
    assert result["new_hooks"][0]["description"] == "谜团待解"
    assert result["new_hooks"][0]["status"] == "active"  # 默认状态


# --- 14. v1 陈旧钩子告警（确定性，无 LLM）---


def test_stale_hook_flagged_in_constraint_block(project: Path) -> None:
    """活跃钩子埋入章与当前章序差 >10 → ⚠ 标志 + 陈旧告警行。

    陈旧检测用 planted_at.path 在文件序中定位，而非 planted_at.chapter 字段。
    """
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    # 铺满从 01 到 13 共 13 章，确保文件序与章号一致
    body = project / "正文"
    for i in range(1, 14):
        (body / f"第{i:02d}章.md").write_text(f"第{i}章\n", encoding="utf-8")

    _write_hooks(
        project,
        [
            {"id": "h_old", "description": "埋在第 1 章的老钩子", "status": "active",
             "planted_at": {"chapter": 1, "path": "正文/第01章.md"}, "category": "mystery"},
            {"id": "h_fresh", "description": "新埋的钩子", "status": "active",
             "planted_at": {"chapter": 12, "path": "正文/第12章.md"}, "category": "oath"},
        ],
    )
    # 当前章序 = 13；h_old 差 12 章（>10），h_fresh 差 1 章（≤10）
    current_file = str(body / "第13章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "⚠" in block
    assert "埋在第 1 章的老钩子" in block
    assert "⚠ 1 条伏笔超过 10 章未推进" in block
    assert "新埋的钩子" in block  # 新鲜钩子正常展示


def test_stale_hook_not_flagged_when_recent(project: Path) -> None:
    """当前章与 planted_at.path 序差 ≤10 → 无 ⚠ 标志。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    b = (project / "正文")
    for i in range(1, 7):
        (b / f"第{i:02d}章.md").write_text("dummy\n", encoding="utf-8")
    _write_hooks(
        project,
        [
            {"id": "h_recent", "description": "近期钩子", "status": "active",
             "planted_at": {"chapter": 3, "path": "正文/第03章.md"}, "category": "countdown"},
        ],
    )

    current_file = str(b / "第04章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    # 第4章序 - 第3章序 = 1 ≤ 10 → 无 ⚠
    assert block is not None
    assert "⚠" not in block
    assert "近期钩子" in block
