"""场景纪律触达护栏：产字路径必须带「一场戏立不立得住」的内部清单。

背景（2026-07-28 诊断）：产字侧此前只有句子层守则（`CRAFT_GUIDELINES` 6 条，全系统去重后
335 字），四条产字路径全是单次 LLM 直出、零规划。于是最常见的坏产出不是句子难看，而是
「这一场删掉也不影响主线」——而判定这件事的判据（`narrative_collapse` rubric 与
「生成前先在内部确认……」）躺在退役批量管线 `book_runs/prompts/` 里，那批构建器零生产
调用方，桌面永远走不到。本刀把打捞回来的清单钉进真正落笔的路径。

本文件的红线有两条，方向相反，都必须可证伪：
1. **写新正文的路径必须带 compose 版**（`file.create` / `prose.continue`）。
2. **改写路径只能带 guard 版**（`file.revise`，`project.trim_prose` 复用同一条）——
   给压缩路径发「先定死四项再动笔」会诱导它为凑齐结构反向加字，与压缩指令直接打架。
"""

from __future__ import annotations

from pathlib import Path

from app.common.craft import (
    SCENE_COLLAPSE_TEST,
    SCENE_DISCIPLINE_ITEMS,
    scene_discipline_clause,
    scene_discipline_guard_clause,
)

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def test_compose_clause_reaches_the_two_paths_that_write_new_prose() -> None:
    """`file.create` 与 `prose.continue` 是真正凭空落笔的两条，必须带完整清单。"""

    from app.domains.assistant import continuation, service

    clause = scene_discipline_clause()
    assert clause in service._DRAFT_SYSTEM_PROMPT
    assert clause in continuation.CONTINUE_SYSTEM_PROMPT


def test_revise_gets_the_guard_wording_and_never_the_compose_one() -> None:
    """本刀最容易做坏的地方：把 compose 版一并灌进改写路径。

    `project.trim_prose` 按百分比压缩，复用的正是 `_REVISE_SYSTEM_PROMPT`。命令它
    「落笔前先把四项定死、全部成立再动笔」会诱导它为补齐结构反向加字——压缩工具越压越长。
    把下面的 guard 换成 compose 即红。
    """

    from app.domains.assistant import service

    assert scene_discipline_guard_clause() in service._REVISE_SYSTEM_PROMPT
    assert scene_discipline_clause() not in service._REVISE_SYSTEM_PROMPT
    assert "全部成立再动笔" in scene_discipline_clause(), "下一行的探针词必须真在 compose 版里"
    assert "全部成立再动笔" not in service._REVISE_SYSTEM_PROMPT


def test_trim_prose_still_rides_the_revise_prompt() -> None:
    """上一条的前提事实：压缩没有自己的 system prompt，走的是 revise。

    哪天 trim 拆出独立 prompt，这里会红，提醒回去重判它该带哪一版措辞。
    """

    source = (_APP_ROOT / "domains" / "agent_runs" / "tools" / "project_canon_runtime.py").read_text(
        encoding="utf-8"
    )
    assert "assistant_service.revise_file_content(" in source


def test_guard_wording_stays_compatible_with_minimal_edits() -> None:
    """改写侧只要求不抽掉承重，不得反过来成为扩大改动范围的理由。

    `_REVISE_SYSTEM_PROMPT` 的最小改动纪律是既有红线；guard 版必须与它同向。
    """

    guard = scene_discipline_guard_clause()
    assert "宁可多留几个字" in guard
    assert "删字、并句、砍副词都可以" in guard


def test_chat_loop_deliberately_stays_out() -> None:
    """循环自己不产字（它靠调工具产字），注入只会稀释 1574 字的工具纪律。

    与文风基线同一条判据（见 `style_baseline` 相关记录）。这是刻意排除，不是遗漏——
    要改成注入，先改这条测试并说明为什么循环需要落笔前清单。
    """

    from app.domains.agent_runs.loop import prompt_context

    assert scene_discipline_clause() not in prompt_context.SYSTEM_PROMPT
    assert scene_discipline_guard_clause() not in prompt_context.SYSTEM_PROMPT


def test_collapse_test_survives_in_both_wordings() -> None:
    """承重判据是这次打捞的核心，两版措辞都不能把它简化掉。

    没有它，四项就退化成又一张风格清单；有它，模型才有一条可自判的否决线。
    """

    assert SCENE_COLLAPSE_TEST in scene_discipline_clause()
    assert "删掉也不影响主线" in scene_discipline_guard_clause()


def test_both_wordings_share_one_item_source() -> None:
    """两处措辞不同但必须同源，否则写与改会各按各的尺子说话。"""

    compose = scene_discipline_clause()
    guard = scene_discipline_guard_clause()
    for name, detail in SCENE_DISCIPLINE_ITEMS:
        assert name in compose, f"compose 版漏了「{name}」"
        assert name in guard, f"guard 版漏了「{name}」"
        assert detail.rstrip("。") in compose, f"compose 版必须带「{name}」的释义"


def test_compose_clause_forbids_leaking_the_checklist_into_prose() -> None:
    """清单是内部规划，不是输出物。

    漏掉这句，模型会把「①视角：……」直接写进补丁，作者正文里就多出一段大纲——
    这是给生成加规划层最典型的翻车形状。
    """

    clause = scene_discipline_clause()
    assert "不要写进正文" in clause
    assert "不要输出清单" in clause


def test_value_shift_is_direction_neutral() -> None:
    """落差不得只认「更糟」——本项目的 n=1 是系统 / 进化流，主角收场时通常更强。

    照搬西方剧作的 "things get worse" 会在本类型里稳定判错，把正常的升级场当过场毙掉。
    """

    compose = scene_discipline_clause()
    assert "变好变坏都算" in compose
    assert "更糟" not in compose

    _, payoff = SCENE_DISCIPLINE_ITEMS[2]
    assert "退不回去" in payoff, "代价项必须容纳「得到某样不可逆的东西」，否则爽文升级不计入不可逆"


def test_author_instructions_outrank_scene_discipline() -> None:
    """层序不变：通用准则 / 场景纪律（base）→ 量出的文风基线 → 作者声明（最后=最强）。

    场景纪律进的是 base_prompt，所以必须排在作者指令之前；拼反即作者的显式要求被通用
    纪律压过。
    """

    from app.common.author_voice import build_generation_system_prompt

    project = Path(__file__).resolve().parent / "_nonexistent_scene_discipline_probe"
    base = "开头。" + scene_discipline_clause()
    assert build_generation_system_prompt(base, str(project)) == base
