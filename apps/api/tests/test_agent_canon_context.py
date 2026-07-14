from __future__ import annotations

from pathlib import Path

from agent_canon_test_support import _QINGYAN, _write_canon, _write_hooks

from app.domains.agent_runs import canon_context, canon_store

pytest_plugins = ("agent_canon_test_fixtures",)


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
    assert "已沉睡 12 章" in block
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


# --- 15. 伏笔 agenda 编排（确定性，无 LLM） ---


def test_hook_agenda_advance_appears_in_constraint_block(project: Path) -> None:
    """当前章有 agenda.advance → 出现「本章伏笔计划 · 应推进」块。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [
            {"id": "h_sword", "description": "青岩欠陆沉一把刀的情", "status": "active",
             "planted_at": {"chapter": 1}, "category": "character_debt"},
        ],
    )
    # 手写 agenda 到 hooks.json（用写 API 避开 schema 检查）
    hooks_data = canon_store.read_hooks(str(project))
    hooks_data["agenda"] = {"3": {"advance": ["h_sword"], "resolve": []}}
    canon_store.write_hooks(str(project), hooks_data)

    body = project / "正文"
    current_file = str(body / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    # 第 2 章没有 agenda → 不应出现计划块
    assert block is not None and "伏笔计划" not in block

    current_file_3 = str(body / "第01章.md")  # 第 1 章非 agenda 目标章
    block_1 = canon_context.build_scene_constraint_block(str(project), current_file_3)
    assert block_1 is None or "伏笔计划" not in block_1

    # 把 current_file 改到第 3 章（构造假档即可，agenda 读 chapter 数值不依赖文件存在）
    # 我们需要第 03 章文件存在才能获取阅读序
    (body / "第03章.md").write_text("第3章内容\n", encoding="utf-8")
    current_file_3 = str(body / "第03章.md")
    block_3 = canon_context.build_scene_constraint_block(str(project), current_file_3)
    assert block_3 is not None
    assert "本章伏笔计划" in block_3
    assert "应推进" in block_3
    assert "青岩欠陆沉" in block_3


def test_hook_agenda_resolve_appears_in_constraint_block(project: Path) -> None:
    """当前章有 agenda.resolve → 出现「应回收」。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [
            {"id": "h_coin", "description": "积分达 10 万触发不可逆事件", "status": "active",
             "planted_at": {"chapter": 2}, "category": "threshold"},
        ],
    )
    hooks_data = canon_store.read_hooks(str(project))
    hooks_data["agenda"] = {"5": {"advance": [], "resolve": ["h_coin"]}}
    canon_store.write_hooks(str(project), hooks_data)

    body = project / "正文"
    for i in range(1, 7):
        (body / f"第{i:02d}章.md").write_text(f"第{i}章\n", encoding="utf-8")

    current_file = str(body / "第05章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "本章伏笔计划" in block
    assert "应回收" in block
    assert "积分达 10 万" in block


def test_hook_agenda_empty_resolve_only_without_advance(project: Path) -> None:
    """advance 空、resolve 有值 → 只推回收不推进。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    _write_hooks(
        project,
        [{"id": "h1", "description": "暗影组织首领身份", "status": "active",
          "planted_at": {"chapter": 1}, "category": "mystery"}],
    )
    hooks_data = canon_store.read_hooks(str(project))
    hooks_data["agenda"] = {"2": {"advance": [], "resolve": ["h1"]}}
    canon_store.write_hooks(str(project), hooks_data)

    body = project / "正文"
    for i in range(1, 4):
        (body / f"第{i:02d}章.md").write_text(f"第{i}章\n", encoding="utf-8")

    current_file = str(body / "第02章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "应推进" not in (block or "")
    assert "应回收" in (block or "")


def test_hook_agenda_missing_hooks_json_returns_clean(project: Path) -> None:
    """无 hooks.json → agenda 块不出现。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    # 不写 hooks.json
    current_file = str(project / "正文" / "第01章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is None or "本章伏笔计划" not in block


# --- 16. 增强陈旧检测：last_advanced_at ---


def test_stale_hook_uses_last_advanced_at(project: Path) -> None:
    """有 last_advanced_at 时用其计算沉睡章数，而非 planted_at。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    body = project / "正文"
    for i in range(1, 16):
        (body / f"第{i:02d}章.md").write_text(f"第{i}章\n", encoding="utf-8")

    # 第 1 章埋入，但第 10 章推进过一次 → 当前第 15 章时只沉睡了 5 章（≤10）
    _write_hooks(
        project,
        [
            {"id": "h_adv", "description": "有推进的钩子", "status": "active",
             "planted_at": {"chapter": 1, "path": "正文/第01章.md"},
             "last_advanced_at": {"chapter": 10, "path": "正文/第10章.md"},
             "category": "mystery"},
        ],
    )

    current_file = str(body / "第15章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    # 自第 10 章推进后仅 5 章 → 不应标记陈旧
    assert block is not None
    assert "⚠" not in (block or "")
    assert "有推进的钩子" in block


def test_stale_hook_last_advanced_at_exceeds_threshold(project: Path) -> None:
    """有 last_advanced_at 且与当前差 >10 → 标记陈旧，显示「自第 N 章推进后沉睡」。"""
    _write_canon(project, {"version": 1, "entities": [], "invariants": {}})
    body = project / "正文"
    for i in range(1, 15):
        (body / f"第{i:02d}章.md").write_text(f"第{i}章\n", encoding="utf-8")

    _write_hooks(
        project,
        [
            {"id": "h_old", "description": "沉睡的钩子", "status": "active",
             "planted_at": {"chapter": 1, "path": "正文/第01章.md"},
             "last_advanced_at": {"chapter": 3, "path": "正文/第03章.md"},
             "category": "countdown"},
        ],
    )

    current_file = str(body / "第14章.md")
    block = canon_context.build_scene_constraint_block(str(project), current_file)
    assert block is not None
    assert "⚠" in block
    assert "自第 3 章推进后已沉睡 11 章" in block
