from __future__ import annotations

from pathlib import Path

import pytest
from agent_canon_test_support import _write_hooks

from app.domains.agent_runs import canon_hooks_delta
from app.domains.agent_runs.tooling import (
    build_loop_tool_name_map,
    build_loop_tool_schemas,
    llm_tool_name,
    loop_patch_tool_specs,
)

pytest_plugins = ("agent_canon_test_fixtures",)


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


# --- 17. evaluate_hook_admission ---


def test_evaluate_hook_admission_rejects_duplicate_substring(project: Path) -> None:
    """description 与既有钩子子串重叠 → 不通过。"""
    existing = {"hooks": [{"description": "青岩欠陆沉一把刀的情", "status": "active"}]}
    result = canon_hooks_delta.evaluate_hook_admission(
        existing,
        {"description": "青岩欠陆沉一把刀的情"},
    )
    assert result["admitted"] is False
    assert "重叠" in (result["reason"] or "")


def test_evaluate_hook_admission_accepts_fresh_hook(project: Path) -> None:
    """全新的钩子 → 通过。"""
    existing = {"hooks": [{"description": "已有钩子", "status": "active"}]}
    result = canon_hooks_delta.evaluate_hook_admission(
        existing,
        {"description": "全新的叙事承诺"},
    )
    assert result["admitted"] is True


def test_evaluate_hook_admission_rejects_empty_description(project: Path) -> None:
    """空 description → 不通过。"""
    result = canon_hooks_delta.evaluate_hook_admission(
        {"hooks": []},
        {"description": ""},
    )
    assert result["admitted"] is False


def test_evaluate_hook_admission_rejects_resolved_hook_duplicate(project: Path) -> None:
    """已回收钩子的描述与新钩子重叠 → 不重投（不回植已回收承诺）。"""
    existing = {"hooks": [{"description": "伏笔已经回收了", "status": "resolved"}]}
    result = canon_hooks_delta.evaluate_hook_admission(
        existing,
        {"description": "伏笔已经回收了"},
    )
    assert result["admitted"] is False
    assert "重叠" in (result["reason"] or "")


# --- 18. trim_prose 工具注册与 schema ---


def test_trim_prose_visible_in_loop_schemas() -> None:
    """project.trim_prose 出现在 LLM 工具循环 schema 中。"""
    schemas = build_loop_tool_schemas()
    names = {schema["function"]["name"] for schema in schemas}
    assert llm_tool_name("project.trim_prose") in names

    name_map = build_loop_tool_name_map()
    assert name_map[llm_tool_name("project.trim_prose")] == "project.trim_prose"
    assert name_map[llm_tool_name("project.trim_prose")] == "project.trim_prose"


def test_trim_prose_is_patch_tool() -> None:
    """project.trim_prose 是 write_pending 工具，占用补丁名额。"""
    patch_names = {spec.name for spec in loop_patch_tool_specs()}
    assert "project.trim_prose" in patch_names


def test_trim_prose_instruction_contains_target() -> None:
    """指令模板包含目标压缩百分比。"""
    from app.domains.agent_runs.runtime import _trim_prose_instruction

    for pct in (10, 15, 20, 30):
        instr = _trim_prose_instruction(pct)
        assert str(pct) in instr
        assert "保留所有剧情信息" in instr
        assert "砍掉冗余的副词" in instr
        assert "字数审计报告" in instr
