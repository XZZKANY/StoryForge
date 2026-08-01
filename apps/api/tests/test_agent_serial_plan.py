"""连载计划：确定性、无 LLM 可证伪。

最要紧的一条不变量：**手稿正文是真值源，计划里的 status 只是声明**。
下面的用例逐条把它钉死——正文已存在的章不能被当成「下一章待写」，
哪怕计划仍标 pending（这正是作者忘记让 agent 调 plan_update 时的默认情形）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from fastapi.testclient import TestClient

from app.domains.agent_runs import serial_plan, serial_plan_update
from app.domains.agent_runs.fs_tools import FsToolError

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def _write_plan(project: Path, payload: dict) -> None:
    plan_dir = project / ".storyforge"
    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "serial-plan.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _chapters(*specs: tuple[int, str]) -> list[dict]:
    return [{"ordinal": ordinal, "status": status} for ordinal, status in specs]


def test_missing_plan_returns_none_not_empty_skeleton(novel_project: Path) -> None:
    """没有计划文件时诚实返回 None，不伪造一份空计划让模型以为「计划里没有章节」。"""

    assert serial_plan.plan_exists(str(novel_project)) is False
    assert serial_plan.build_plan(str(novel_project)) is None
    assert serial_plan.build_plan_block(str(novel_project)) is None


def test_plan_with_no_chapters_returns_none(novel_project: Path) -> None:
    _write_plan(novel_project, {"version": 1, "premise": "灯塔", "chapters": []})

    assert serial_plan.build_plan(str(novel_project)) is None


def test_written_chapter_is_never_the_next_chapter_even_when_plan_says_pending(
    novel_project: Path,
) -> None:
    """核心不变量：第 1 章正文已存在，计划却标 pending —— 下一章必须是第 2 章。

    按 status 挑（而非按正文挑）会挑回第 1 章，让 agent 重写一章已经写完的正文。
    """

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "pending"))})

    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].written is True
    assert plan.chapters[0].written_path == "正文/第01章.md"
    assert plan.next_chapter is not None
    assert plan.next_chapter.ordinal == 2


def test_blocked_chapter_is_skipped_as_next(novel_project: Path) -> None:
    _write_plan(
        novel_project,
        {"version": 1, "chapters": _chapters((1, "done"), (2, "blocked"), (3, "pending"))},
    )

    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.next_chapter is not None
    assert plan.next_chapter.ordinal == 3
    assert [chapter.ordinal for chapter in plan.blocked_chapters] == [2]


def test_drift_is_reported_in_both_directions(novel_project: Path) -> None:
    """写了没标 done、标了 done 却没正文——两个方向都要报出来。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "done"))})

    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    drifted = {chapter.ordinal: chapter for chapter in plan.drifted_chapters}
    assert set(drifted) == {1, 2}
    assert drifted[1].written is True and drifted[1].status == "pending"
    assert drifted[2].written is False and drifted[2].status == "done"

    block = serial_plan.render_plan_block(plan)
    assert block is not None
    assert "计划与正文对不上" in block
    assert "以正文为准" in block


def test_no_drift_section_when_plan_matches_manuscript(novel_project: Path) -> None:
    """变异守卫：计划与正文一致时不能报漂移，否则上一条用例是恒真的。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "done"), (2, "pending"))})

    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.drifted_chapters == []
    block = serial_plan.render_plan_block(plan)
    assert block is not None
    assert "计划与正文对不上" not in block


def test_plan_block_carries_next_chapter_goal(novel_project: Path) -> None:
    _write_plan(
        novel_project,
        {
            "version": 1,
            "premise": "审计员追查灯塔错误闪光",
            "chapter_word_count_min": 2000,
            "chapter_word_count_max": 3500,
            "chapters": [
                {"ordinal": 1, "status": "done"},
                {"ordinal": 2, "title": "回声", "goal": "林岚发现闪光有规律", "status": "pending"},
                {"ordinal": 3, "title": "潮位", "goal": "潮汐表对不上", "status": "pending"},
            ],
            "arcs": [
                {"arc_id": "lamp", "title": "灯塔真相", "target_chapters": [2], "payoff_chapter": 9}
            ],
        },
    )

    block = serial_plan.build_plan_block(str(novel_project))
    assert block is not None
    assert "第 2 章《回声》" in block
    assert "林岚发现闪光有规律" in block
    assert "2000–3500 字" in block
    assert "「灯塔真相」本章是推进点" in block
    # 再往后的章只给标题与目标，不把整份计划倒进 prompt。
    assert "第 3 章《潮位》" in block


def test_chapter_ordinal_matches_canon_rebuild_reading_order(novel_project: Path) -> None:
    """章序必须与 canon / 作品底座同一把尺，否则计划说第 2 章、底座说第 3 章。"""

    from app.domains.agent_runs import canon_rebuild

    (novel_project / "正文" / "第02章.md").write_text("潮位对不上。\n", encoding="utf-8")
    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "done"), (2, "done"), (3, "pending"))})

    ordinals = canon_rebuild.chapter_ordinals(str(novel_project), "*.md")
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.written_ordinals == frozenset(ordinals.values())
    assert plan.next_chapter is not None
    assert plan.next_chapter.ordinal == 3


# --- merge：纯函数，不碰盘 ---------------------------------------------------


def test_merge_keeps_untouched_fields_when_only_status_is_sent() -> None:
    """只标 done 不能清掉作者写的 title / goal —— 这是「逐字段合并」的存在理由。"""

    existing = {
        "version": 1,
        "chapters": [{"ordinal": 2, "title": "回声", "goal": "发现规律", "status": "pending"}],
    }

    merged, counts = serial_plan_update.merge_plan_payload(
        existing, chapters=[{"ordinal": 2, "status": "done"}]
    )

    assert merged["chapters"] == [
        {"ordinal": 2, "title": "回声", "goal": "发现规律", "status": "done"}
    ]
    assert counts == {"created_count": 0, "updated_count": 1, "removed_count": 0, "skipped_count": 0}


def test_merge_creates_sorts_and_removes() -> None:
    merged, counts = serial_plan_update.merge_plan_payload(
        {"version": 1, "chapters": [{"ordinal": 5, "status": "pending"}]},
        chapters=[{"ordinal": 2, "title": "回声"}, {"ordinal": 1, "title": "错误闪光"}],
        remove_ordinals=[5],
        premise="审计员追查灯塔",
    )

    assert [chapter["ordinal"] for chapter in merged["chapters"]] == [1, 2]
    assert merged["premise"] == "审计员追查灯塔"
    assert counts["created_count"] == 2
    assert counts["removed_count"] == 1


def test_merge_rejects_unknown_status_and_bad_ordinal() -> None:
    merged, counts = serial_plan_update.merge_plan_payload(
        {"version": 1, "chapters": []},
        chapters=[
            {"ordinal": 1, "status": "完成了"},
            {"ordinal": 0},
            {"ordinal": "二"},
            {"title": "没有章序"},
        ],
    )

    # 非法 status 落回 pending（不静默接受任意字符串），非正整数章序一律跳过。
    assert merged["chapters"] == [{"ordinal": 1, "status": "pending"}]
    assert counts["skipped_count"] == 3


def test_merge_does_not_mutate_input() -> None:
    existing = {"version": 1, "chapters": [{"ordinal": 1, "status": "pending"}]}

    serial_plan_update.merge_plan_payload(existing, chapters=[{"ordinal": 1, "status": "done"}])

    assert existing["chapters"] == [{"ordinal": 1, "status": "pending"}]


# --- 落盘 -------------------------------------------------------------------


def test_apply_update_creates_plan_and_never_touches_manuscript(novel_project: Path) -> None:
    """首次调用即建计划；正文一个字节都不能变（写回红线）。"""

    chapter_one = novel_project / "正文" / "第01章.md"
    before = chapter_one.read_bytes()

    output = serial_plan_update.apply_plan_update(
        str(novel_project),
        chapters=[{"ordinal": 1, "status": "done"}, {"ordinal": 2, "goal": "潮位对不上"}],
    )

    plan_file = novel_project / ".storyforge" / "serial-plan.json"
    assert plan_file.is_file()
    assert json.loads(plan_file.read_text(encoding="utf-8"))["chapters"][1]["goal"] == "潮位对不上"
    assert output["planned_total"] == 2
    assert output["next_ordinal"] == 2
    assert output["created_count"] == 2
    assert chapter_one.read_bytes() == before
    # 计划只落 .storyforge/，不在项目根散落文件、也不在正文目录里留东西。
    assert sorted(p.name for p in novel_project.iterdir()) == [".storyforge", "正文", "设定"]
    assert [p.name for p in (novel_project / "正文").iterdir()] == ["第01章.md"]


def test_apply_update_rejects_done_for_unwritten_chapter(novel_project: Path) -> None:
    """真跑逮到的行为 bug：模型起草完补丁就把该章标 done，可补丁还没被作者接受、正文不存在。

    必须整调用报错而非默默降级——降级会留下模型已经对作者说出口的那句「已标记完成」。
    """

    with pytest.raises(FsToolError) as excinfo:
        serial_plan_update.apply_plan_update(
            str(novel_project), chapters=[{"ordinal": 2, "status": "done"}]
        )

    assert "第 2 章" in str(excinfo.value)
    assert "补丁" in str(excinfo.value)
    # 报错即整调用不落盘：计划文件不能被建出来。
    assert not (novel_project / ".storyforge" / "serial-plan.json").exists()


def test_apply_update_allows_done_once_manuscript_exists(novel_project: Path) -> None:
    """变异守卫：正文存在时 done 必须放行，否则上一条闸是「一律拒绝」而非「按正文判」。"""

    output = serial_plan_update.apply_plan_update(
        str(novel_project), chapters=[{"ordinal": 1, "status": "done"}]
    )

    assert output["updated_count"] + output["created_count"] == 1
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].status == "done"
    assert plan.drifted_chapters == []


def test_reject_premature_done_only_flags_unwritten_done() -> None:
    written = frozenset({1, 3})
    chapters = [
        {"ordinal": 1, "status": "done"},      # 正文在 → 放行
        {"ordinal": 2, "status": "done"},      # 正文不在 → 拦
        {"ordinal": 3, "status": "pending"},   # 不是 done → 不管
        {"ordinal": 4, "status": "blocked"},   # 不是 done → 不管
        {"ordinal": 5, "goal": "只改目标"},     # 没传 status → 不管
    ]

    assert serial_plan_update.reject_premature_done(chapters, written) == [2]


def test_apply_update_is_idempotent(novel_project: Path) -> None:
    serial_plan_update.apply_plan_update(str(novel_project), chapters=[{"ordinal": 2, "goal": "潮位"}])
    first = (novel_project / ".storyforge" / "serial-plan.json").read_bytes()

    output = serial_plan_update.apply_plan_update(str(novel_project), chapters=[{"ordinal": 2, "goal": "潮位"}])

    assert (novel_project / ".storyforge" / "serial-plan.json").read_bytes() == first
    assert output["created_count"] == 0
    assert output["updated_count"] == 1


def test_corrupt_plan_raises_rather_than_silently_resetting(novel_project: Path) -> None:
    """坏 JSON 必须报错，不能静默当空计划——那会把作者的计划覆盖掉。"""

    plan_dir = novel_project / ".storyforge"
    plan_dir.mkdir(parents=True)
    (plan_dir / "serial-plan.json").write_text("{不是 json", encoding="utf-8")

    with pytest.raises(FsToolError):
        serial_plan.read_plan(str(novel_project))
    # 投影层吞掉异常返回 None（计划块是加分项，不能拖垮对话）。
    assert serial_plan.build_plan(str(novel_project)) is None


# --- 接受补丁后回调标 done -------------------------------------------------


def test_mark_written_marks_the_accepted_chapter_done(novel_project: Path) -> None:
    """正文已落盘 + 该章在计划里 → 标 done 并把下一章前移。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "pending"))})

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome["updated"] is True
    assert outcome["ordinal"] == 1
    assert outcome["next_ordinal"] == 2
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].status == "done"
    assert plan.drifted_chapters == []


def test_mark_written_accepts_absolute_path(novel_project: Path) -> None:
    """桌面端补丁里的 file_path 是绝对路径，必须能归一。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    absolute = str((novel_project / "正文" / "第01章.md").resolve())

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), absolute)

    assert outcome["updated"] is True
    assert outcome["path"] == "正文/第01章.md"


def test_mark_written_does_not_create_a_plan(novel_project: Path) -> None:
    """没在用连载计划的项目，不能因为接受了一个补丁就被塞一份计划。"""

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome == {"updated": False, "reason": "no_plan", "ordinal": 1}
    assert not (novel_project / ".storyforge" / "serial-plan.json").exists()


def test_mark_written_does_not_append_unplanned_chapter(novel_project: Path) -> None:
    """写了计划外的一章是作者要知道的事，悄悄补进计划等于把它抹平。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((5, "pending"))})

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome["updated"] is False
    assert outcome["reason"] == "chapter_not_in_plan"
    plan_raw = json.loads((novel_project / ".storyforge" / "serial-plan.json").read_text(encoding="utf-8"))
    assert [c["ordinal"] for c in plan_raw["chapters"]] == [5]


def test_mark_written_ignores_non_manuscript_file(novel_project: Path) -> None:
    """接受的是设定 / 人物这类补丁时，不是「写完一章」。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "设定/人物.md")

    assert outcome["updated"] is False
    assert outcome["reason"] == "not_a_manuscript_chapter"
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].status == "pending"


def test_mark_written_refuses_when_manuscript_missing(novel_project: Path) -> None:
    """写盘失败或路径对不上时宁可什么都不做——同 reject_premature_done 的真值源纪律。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((2, "pending"))})

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "正文/第02章.md")

    assert outcome["updated"] is False
    assert outcome["reason"] == "not_a_manuscript_chapter"


def test_mark_written_is_idempotent(novel_project: Path) -> None:
    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")
    before = (novel_project / ".storyforge" / "serial-plan.json").read_bytes()

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome == {"updated": False, "reason": "already_done", "ordinal": 1}
    assert (novel_project / ".storyforge" / "serial-plan.json").read_bytes() == before


def test_mark_written_rejects_path_outside_project(novel_project: Path) -> None:
    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    # novel_project 就是 tmp_path 本身，真正的「项目外」得往上一层放。
    outsider = novel_project.parent / "别处.md"
    outsider.write_text("x", encoding="utf-8")

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), str(outsider))

    assert outcome == {"updated": False, "reason": "path_outside_project"}


def test_mark_written_accepts_forward_slash_absolute_path(novel_project: Path) -> None:
    """桌面端在 Windows 上给的是 `D:/连载/…` 这种正斜杠绝对路径，别只按反斜杠算。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    forward = str((novel_project / "正文" / "第01章.md").resolve()).replace("\\", "/")

    outcome = serial_plan_update.mark_chapter_written(str(novel_project), forward)

    assert outcome["updated"] is True
    assert outcome["path"] == "正文/第01章.md"


def test_mark_written_command_is_reachable(novel_project: Path) -> None:
    """走 IDE 命令注册表这一路（桌面端实际调的入口），不只是直调函数。"""

    from app.domains.ide.command_registry import execute_ide_command_by_id

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "pending"))})

    result = execute_ide_command_by_id(
        "plan.mark_written",
        {"project_root": str(novel_project), "file_path": "正文/第01章.md"},
    )

    assert result.payload["plan"]["updated"] is True
    assert result.payload["plan"]["next_ordinal"] == 2


# --- 撤销新建后的反向回调 ---------------------------------------------------


def test_mark_written_records_the_manuscript_path(novel_project: Path) -> None:
    """标 done 时必须把路径记进计划——后来撤销时只有它认得出是哪一章。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})

    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    raw = json.loads((novel_project / ".storyforge" / "serial-plan.json").read_text(encoding="utf-8"))
    assert raw["chapters"][0]["path"] == "正文/第01章.md"


def test_unmark_reverts_done_after_the_manuscript_is_deleted(novel_project: Path) -> None:
    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "pending"))})
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")
    (novel_project / "正文" / "第01章.md").unlink()

    outcome = serial_plan_update.unmark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome["updated"] is True
    assert outcome["ordinal"] == 1
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].status == "pending"
    assert plan.chapters[0].written is False
    # 路径一并抹掉：这章又变回「还没落盘」，留着旧路径会让下次撤销认到一个不存在的东西。
    raw = json.loads((novel_project / ".storyforge" / "serial-plan.json").read_text(encoding="utf-8"))
    assert "path" not in raw["chapters"][0]


def test_unmark_refuses_while_manuscript_still_exists(novel_project: Path) -> None:
    """修订的撤销走反向写回，文件还在——那章依然是写完的，退回 pending 就错了。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")

    outcome = serial_plan_update.unmark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome["updated"] is False
    assert outcome["reason"] == "manuscript_still_exists"
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert plan.chapters[0].status == "done"


def test_unmark_identifies_chapter_by_path_not_by_shifted_ordinal(novel_project: Path) -> None:
    """核心：章序是「路径序第几个」，删一个文件会让后面的章整体前移。

    这里第 1、2 章都已落盘并标 done；删掉第 1 章后，第 2 章的**文件**变成了路径序第 1 个。
    按章序认会把第 1 章退成 pending（错，它本来就该退）……更糟的是若按章序退「第 1 个」，
    实际退的是第 2 章的条目。只有按记下的路径才认得对。
    """

    (novel_project / "正文" / "第02章.md").write_text("第二章。\n", encoding="utf-8")
    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"), (2, "pending"))})
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第02章.md")
    # 删掉第 2 章的正文：此后 第01章.md 仍是路径序第 1 个，没有任何文件占据序号 2。
    (novel_project / "正文" / "第02章.md").unlink()

    outcome = serial_plan_update.unmark_chapter_written(str(novel_project), "正文/第02章.md")

    assert outcome["updated"] is True
    assert outcome["ordinal"] == 2, "退的必须是第 2 章，不能因为章序前移退错章"
    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert [c.status for c in plan.chapters] == ["done", "pending"]
    assert [c.written for c in plan.chapters] == [True, False]


def test_written_is_judged_by_recorded_path_when_ordinals_shift(novel_project: Path) -> None:
    """正文出现空缺时，记过路径的章不能被前移的章序判错在场。

    只有 第01章.md 与 第03章.md 存在时，第03章.md 的**章序是 2**。若仍按章序判，
    计划第 2 章会被当成已落盘、第 3 章被当成没写——两处都反了。
    """

    (novel_project / "正文" / "第03章.md").write_text("第三章。\n", encoding="utf-8")
    _write_plan(
        novel_project,
        {
            "version": 1,
            "chapters": [
                {"ordinal": 1, "status": "done", "path": "正文/第01章.md"},
                {"ordinal": 2, "status": "pending"},
                {"ordinal": 3, "status": "done", "path": "正文/第03章.md"},
            ],
        },
    )

    plan = serial_plan.build_plan(str(novel_project))
    assert plan is not None
    assert [c.written for c in plan.chapters] == [True, False, True]
    assert plan.next_chapter is not None
    assert plan.next_chapter.ordinal == 2, "没写的是第 2 章"
    assert plan.drifted_chapters == []


def test_unmark_does_not_guess_when_path_was_never_recorded(novel_project: Path) -> None:
    """计划里没记过这个路径（done 是本次改动之前标的）就如实说认不出，不按章序猜。"""

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "done"))})
    (novel_project / "正文" / "第01章.md").unlink()

    outcome = serial_plan_update.unmark_chapter_written(str(novel_project), "正文/第01章.md")

    assert outcome["updated"] is False
    assert outcome["reason"] == "chapter_not_identifiable"
    plan_raw = json.loads((novel_project / ".storyforge" / "serial-plan.json").read_text(encoding="utf-8"))
    assert plan_raw["chapters"][0]["status"] == "done"


def test_unmark_command_is_reachable(novel_project: Path) -> None:
    from app.domains.ide.command_registry import execute_ide_command_by_id

    _write_plan(novel_project, {"version": 1, "chapters": _chapters((1, "pending"))})
    serial_plan_update.mark_chapter_written(str(novel_project), "正文/第01章.md")
    (novel_project / "正文" / "第01章.md").unlink()

    result = execute_ide_command_by_id(
        "plan.unmark_written",
        {"project_root": str(novel_project), "file_path": "正文/第01章.md"},
    )

    assert result.payload["plan"]["updated"] is True


# --- 接进对话循环 ---------------------------------------------------------


def test_chat_loop_plan_update_writes_plan_only_and_advances_next_chapter(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """循环内 plan_update：计划文件真的被推进，手稿正文一个字节不变。

    只断言 schema 里有这把工具会假绿（spec 加了、handler 没注册也照样绿），
    所以这里断言的是落盘后果与 next_ordinal 前移。
    """

    _enable_loop_env(monkeypatch)
    chapter_one = novel_project / "正文" / "第01章.md"
    manuscript_before = chapter_one.read_bytes()

    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_plan_update",
                            "arguments": json.dumps(
                                {
                                    "premise": "审计员追查灯塔错误闪光",
                                    "chapters": [
                                        {"ordinal": 1, "title": "错误闪光", "status": "done"},
                                        {"ordinal": 2, "title": "回声", "goal": "闪光有规律"},
                                        {"ordinal": 3, "title": "潮位", "goal": "潮汐表对不上"},
                                    ],
                                }
                            ),
                        },
                    }
                ],
                "completion_tokens": 3,
            },
            {"content": "计划已建好，下一章是第 2 章《回声》。", "tool_calls": [], "completion_tokens": 5},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-chat-loop-plan-update",
        project_path=str(novel_project),
        message="按这个大纲把前三章的计划建起来",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = result["tool_trace"][0]
    assert trace["tool_name"] == "project.plan_update"
    assert trace["output_summary"] == {
        "planned_total": 3,
        "next_ordinal": 2,
        "created_count": 3,
        "updated_count": 0,
    }

    plan_file = novel_project / ".storyforge" / "serial-plan.json"
    plan = json.loads(plan_file.read_text(encoding="utf-8"))
    assert [chapter["ordinal"] for chapter in plan["chapters"]] == [1, 2, 3]
    assert plan["premise"] == "审计员追查灯塔错误闪光"
    # 写回红线：计划工具绝不碰手稿。
    assert chapter_one.read_bytes() == manuscript_before

    # 模型收到的是完整 output（很小且 next_ordinal 是它下一步要用的），不是 summary-only。
    tool_messages = [item for item in calls[1]["messages"] if item.get("role") == "tool"]
    assert '"next_ordinal": 2' in str(tool_messages[0]["content"]).replace("'", '"')

    tool_calls = client.get(f"/api/assistant/sessions/{result['assistant_session_id']}/tool-calls").json()
    assert "project.plan_update" in [item["tool_name"] for item in tool_calls]


def test_chat_loop_injects_plan_block_with_next_chapter(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    """计划块必须真的进 system prompt —— 这是「agent 每轮知道下一章写什么」的全部依据。"""

    _enable_loop_env(monkeypatch)
    plan_dir = novel_project / ".storyforge"
    plan_dir.mkdir(parents=True)
    (plan_dir / "serial-plan.json").write_text(
        json.dumps(
            {
                "version": 1,
                "chapters": [
                    {"ordinal": 1, "title": "错误闪光", "status": "done"},
                    {"ordinal": 2, "title": "回声", "goal": "林岚发现闪光有规律", "status": "pending"},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    calls = _fake_llm_script(
        monkeypatch,
        [{"content": "下一章是第 2 章《回声》。", "tool_calls": [], "completion_tokens": 5}],
    )

    _send_chat_message(
        client,
        run_id="run-chat-loop-plan-block",
        project_path=str(novel_project),
        message="下一章写什么",
    )

    system_text = "\n".join(
        str(item.get("content")) for item in calls[0]["messages"] if item.get("role") == "system"
    )
    assert "[连载计划 · 确定性]" in system_text
    assert "第 2 章《回声》" in system_text
    assert "林岚发现闪光有规律" in system_text
