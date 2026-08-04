"""章序判据护栏：非正文文件不得占章号。

背景（2026-07-28 诊断）：后端此前对「哪些 .md 是正文」没有概念，章序直接取
`iter_project_files` 的路径序。产品自带示例项目（`initialize.ts`）建出来就有
`大纲/总纲.md`、`人物/主角.md`、`正文/第01章.md` 三个文件，按码点序是 人物 < 大纲 < 正文，
于是**作者的第 1 章从第一天起就被算成第 3 章**——canon 退场闸、伏笔到期判定与实体预算
阈值全部按虚高的章号跑。

本文件的红线：
1. **产品自带示例项目的第 1 章必须是第 1 章**（这条在修复前必红）。
2. **黑名单不是白名单**：章节直接放项目根仍算正文，不强迫作者重组目录。
3. **前后端判据同源**：前端 `semantics.ts` 的 `DIR_KIND` 是这套目录约定的出处，
   它加一个非正文目录而后端没跟上，本文件即红。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.common.manuscript import (
    NON_MANUSCRIPT_DIRS,
    is_manuscript_path,
    previous_chapter_tail,
)
from app.common.style_baseline import _iter_manuscript_files
from app.domains.agent_runs.canon_rebuild import _chapter_ordinals
from app.domains.agent_runs.entity_budget_scan import _chapter_ordinal
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.promise_scan import promise_check

_SEMANTICS_TS = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "desktop"
    / "frontend"
    / "src"
    / "lib"
    / "project"
    / "semantics.ts"
)

# 与 initialize.ts:43/56/66 逐字对应——产品「新建项目」实际落盘的三个文件。
_SHIPPED_EXAMPLE_PROJECT = (
    ("大纲/总纲.md", "# 总纲\n\n这本书讲什么。"),
    ("人物/主角.md", "# 主角\n\n他是谁。"),
    ("正文/第01章.md", "# 第01章\n\n他推开门，风灌了进来。"),
)


def _make_project(tmp_path: Path, files: tuple[tuple[str, str], ...]) -> Path:
    for relative, body in files:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
    return tmp_path


def test_shipped_example_project_chapter_one_is_chapter_one(tmp_path: Path) -> None:
    """本刀修的真 bug，行为级证伪。

    修复前这里算出 `正文/第01章.md` = 第 3 章，且 `人物/主角.md` = 第 1 章。
    把 `_chapter_ordinals` 里的 `_is_manuscript` 过滤删掉，本测试即红。
    """

    root = _make_project(tmp_path, _SHIPPED_EXAMPLE_PROJECT)
    ordinals = _chapter_ordinals(str(root), "*.md")

    assert ordinals == {"正文/第01章.md": 1}
    assert "人物/主角.md" not in ordinals
    assert "大纲/总纲.md" not in ordinals


def test_promise_progress_is_not_inflated_by_non_manuscript_files(tmp_path: Path) -> None:
    """章序虚高会顺着 `current_chapter` 传染到伏笔到期判定。

    作者刚写完第 1 章，系统却认为进度已到第 3 章——按 due_chapter 排的伏笔会集体提前到期。
    """

    root = _make_project(tmp_path, _SHIPPED_EXAMPLE_PROJECT)
    canon_dir = root / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    (canon_dir / "canon.json").write_text(
        json.dumps({"version": 1, "entities": [], "invariants": {"promises": []}}, ensure_ascii=False),
        encoding="utf-8",
    )

    assert promise_check(str(root))["current_chapter"] == 1


def test_entity_budget_ordinal_counts_only_manuscript_files(tmp_path: Path) -> None:
    """实体预算的 20 / 25 / 30 章硬阈值直接吃这个数，此前连图片和 json 都占章号。"""

    root = _make_project(
        tmp_path,
        (
            ("大纲/总纲.md", "# 总纲"),
            ("人物/主角.md", "# 主角"),
            ("设定/世界.md", "# 世界"),
            ("正文/第01章.md", "# 第01章"),
            ("正文/第02章.md", "# 第02章"),
        ),
    )

    assert _chapter_ordinal(root, root / "正文" / "第01章.md", "正文/第01章.md") == 1
    assert _chapter_ordinal(root, root / "正文" / "第02章.md", "正文/第02章.md") == 2


def test_entity_budget_ordinal_refuses_non_manuscript_target(tmp_path: Path) -> None:
    """不创建假数据兜底：非正文文件问不出章序，明确报错而不是回一个编造的数字。"""

    root = _make_project(tmp_path, _SHIPPED_EXAMPLE_PROJECT)
    with pytest.raises(FsToolError):
        _chapter_ordinal(root, root / "人物" / "主角.md", "人物/主角.md")


def test_style_baseline_corpus_excludes_settings_and_outlines(tmp_path: Path) -> None:
    """文风基线是要写进产字 prompt 当「作者文风」的，语料混进条目式设定会把数字测偏。

    大纲与人物设定没有对白、几乎没有完整句：混进去会压低对白密度、拉偏句长。
    """

    root = _make_project(
        tmp_path,
        (
            ("大纲/总纲.md", "- 第一卷：起\n- 第二卷：承\n" * 40),
            ("设定/世界.md", "- 灵气复苏\n- 系统\n" * 40),
            ("正文/第01章.md", "“走。”他说。\n" * 40),
            ("正文/第02章.md", "“别动。”她拦住他。\n" * 40),
        ),
    )

    corpus = {path.relative_to(root).as_posix() for path in _iter_manuscript_files(root)}
    assert corpus == {"正文/第01章.md", "正文/第02章.md"}


def test_project_knowledge_directories_never_count_as_manuscript(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        (
            ("正文/第01章.md", "# 第一章"),
            (".资料/黄金三章spec.md", "黄金三章规则"),
            ("资料/playbook.md", "写作手册"),
            ("materials/voice.md", "文风"),
            ("knowledge/canon.md", "事实"),
        ),
    )

    assert {path.relative_to(root).as_posix() for path in _iter_manuscript_files(root)} == {
        "正文/第01章.md"
    }


def test_root_level_chapters_still_count(tmp_path: Path) -> None:
    """取黑名单而非白名单的理由：不强迫作者先重组目录才能让 canon 算对章号。"""

    root = _make_project(tmp_path, (("第01章.md", "# 一"), ("第02章.md", "# 二")))
    assert _chapter_ordinals(str(root), "*.md") == {"第01章.md": 1, "第02章.md": 2}


def test_draft_directory_aliases_are_all_treated_as_manuscript() -> None:
    """正文目录的各种叫法都得认，否则换个目录名就算不出章。"""

    for directory in ("正文", "draft", "drafts", "chapter", "chapters", "manuscript"):
        assert is_manuscript_path(f"{directory}/第01章.md"), directory
        assert directory not in NON_MANUSCRIPT_DIRS


def test_backend_and_frontend_share_one_directory_convention() -> None:
    """跨栈防漂移闸：目录约定的出处是前端 `semantics.ts`，后端只是接上同一套。

    前端新增一个非正文目录（比如 `笔记: 'other'`）而后端没跟上，本测试即红——
    否则作者在文件树里看到的分类与 canon 算的章号会再次错开。
    """

    assert _SEMANTICS_TS.is_file(), f"找不到前端目录约定源：{_SEMANTICS_TS}"
    source = _SEMANTICS_TS.read_text(encoding="utf-8")
    block = re.search(r"const DIR_KIND[^=]*=\s*\{(.*?)\n\};", source, re.S)
    assert block is not None, "semantics.ts 的 DIR_KIND 形状变了，本闸需同步"

    raw_pairs = re.findall(
        r"^\s*(?:'([^']+)'|([^\s:,]+)):\s*'(\w+)'",
        block.group(1),
        re.M,
    )
    pairs = [(quoted or bare, kind) for quoted, bare, kind in raw_pairs]
    assert pairs, "没解析出任何 DIR_KIND 条目，正则失效即等于护栏空转"

    frontend_non_draft = {name.lower() for name, kind in pairs if kind != "draft"}
    assert frontend_non_draft == set(NON_MANUSCRIPT_DIRS)


def test_previous_chapter_tail_feeds_the_ending_not_the_opening(tmp_path: Path) -> None:
    """作者新建空的下一章说「接着往下写」时，上一章的**结尾**必须进得来。

    诊断（2026-07-29）：全仓上下没有任何一处把「上一章正文」放进过模型上下文，
    而空章续写的 prompt 里还字面写着「你要写的是开头」——不是缺上下文，是主动
    给了模型一个错误前提，它会另起炉灶重开一个场。
    """

    manuscript = tmp_path / "正文"
    manuscript.mkdir()
    (manuscript / "第001章.md").write_text("第一章开场。\n\n" + "铺垫。" * 200, encoding="utf-8")
    (manuscript / "第002章.md").write_text(
        "第二章开场白。\n\n" + "中段。" * 800 + "\n\n他把刀插回鞘里，转身走进雨里。",
        encoding="utf-8",
    )
    (manuscript / "第003章.md").write_text("", encoding="utf-8")
    # 非正文文件不得被当成「上一章」。
    (tmp_path / "大纲").mkdir()
    (tmp_path / "大纲" / "总纲.md").write_text("全书三幕。", encoding="utf-8")

    found = previous_chapter_tail(str(tmp_path), str(manuscript / "第003章.md"))

    assert found is not None
    relative, tail = found
    assert relative == "正文/第002章.md"
    assert tail.endswith("他把刀插回鞘里，转身走进雨里。")
    assert "第二章开场白" not in tail, "取的必须是结尾，不是开头"
    assert "第一章开场" not in tail, "只取紧邻的上一章"


def test_previous_chapter_tail_has_no_previous_for_the_first_chapter(tmp_path: Path) -> None:
    manuscript = tmp_path / "正文"
    manuscript.mkdir()
    (manuscript / "第001章.md").write_text("开篇。", encoding="utf-8")
    (tmp_path / "人物").mkdir()
    (tmp_path / "人物" / "主角.md").write_text("陈默，二十七岁。", encoding="utf-8")

    assert previous_chapter_tail(str(tmp_path), str(manuscript / "第001章.md")) is None
    # 当前文件不是正文时也没有「上一章」可言。
    assert previous_chapter_tail(str(tmp_path), str(tmp_path / "人物" / "主角.md")) is None
    assert previous_chapter_tail(str(tmp_path), None) is None
    assert previous_chapter_tail(str(tmp_path), str(tmp_path / "不存在.md")) is None


def test_continue_prompt_never_calls_an_empty_chapter_the_book_opening(tmp_path: Path) -> None:
    """有上一章时，空章 prompt 必须改口——「写的是开头」这句会让模型另起炉灶。"""

    from app.domains.assistant import continuation

    with_previous = continuation.build_continue_prompt(
        tail="",
        file_path="正文/第003章.md",
        previous_chapter=("正文/第002章.md", "他把刀插回鞘里，转身走进雨里。"),
    )
    assert "他把刀插回鞘里" in with_previous
    assert "正文/第002章.md" in with_previous
    assert "你要写的是开头。" not in with_previous
    # 本章上文必须离落笔处更近：上一章尾排在它之前。
    both = continuation.build_continue_prompt(
        tail="本章已有的上文。",
        file_path="正文/第003章.md",
        previous_chapter=("正文/第002章.md", "上一章结尾。"),
    )
    assert both.index("上一章结尾。") < both.index("本章已有的上文。")

    # 真·全书第一章仍应说「你要写的是开头」。
    first = continuation.build_continue_prompt(tail="", file_path="正文/第001章.md")
    assert "这份稿件当前还是空的，你要写的是开头。" in first
