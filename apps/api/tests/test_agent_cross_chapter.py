"""跨章一致性接进对话循环（`project.cross_chapter_check`）。

背景（2026-07-30 诊断）：`ide/cross_chapter_consistency.py` 早就能把多章完整正文一起喂给
语义模型找跨章硬冲突，但**出口只有 REST 端点和 CLI，没有 ToolSpec，对话循环调不到**；
与此同时 system prompt 一直在教模型用只看单章的 `project_deep_consistency`。

    结构上，一个只读得了单章的检查器，永远抓不到「第 3 章说左臂受伤、第 11 章用左手拔剑」。

本文件的红线：
- 工具真的对 LLM 可见（在派生的 loop schema 里）；
- 章按**阅读序**排好再喂（模型给的顺序不可信，而「按叙事顺序」是那份 prompt 的前提）；
- 失败显式报错，绝不伪造「没有冲突」。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script, _send_chat_message
from fastapi.testclient import TestClient

from app.common.llm_client import LLMConfigError, LLMError
from app.domains.agent_runs import cross_chapter, fs_tools
from app.domains.agent_runs.tools import build_loop_tool_schemas

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


@pytest.fixture()
def serial(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第001章.md").write_text("他的左臂在爆炸里废了。\n", encoding="utf-8")
    (tmp_path / "正文" / "第002章.md").write_text("雨停时他仍站在原地。\n", encoding="utf-8")
    (tmp_path / "正文" / "第003章.md").write_text("他左手拔剑，快得没人看清。\n", encoding="utf-8")
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定" / "世界观.md").write_text("剑是唯一的通货。\n", encoding="utf-8")
    return tmp_path


def _stub_checker(monkeypatch: pytest.MonkeyPatch, result: object) -> list[dict]:
    """替掉真实 LLM 调用，返回捕获到的入参（章序断言看的就是它）。"""

    seen: list[dict] = []

    def fake_check(source, chapters, *, focus=None):  # noqa: ANN001
        seen.append({"chapters": chapters, "focus": focus})
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(cross_chapter, "check_cross_chapter_consistency", fake_check)
    return seen


_EMPTY = {"findings": [], "model": "fake-model", "latency_ms": 12}


# --- 对 LLM 可见 ---


def test_tool_is_exposed_to_the_llm_loop() -> None:
    """没进 loop schema 就等于没接线——能力再全，模型也调不到。"""

    names = {schema["function"]["name"] for schema in build_loop_tool_schemas()}
    assert "project_cross_chapter_check" in names


def test_loop_schema_requires_paths_and_mentions_the_single_chapter_gap() -> None:
    """schema 得说清它与 deep_consistency 的分工，否则模型不知道该换哪把。"""

    schema = next(
        item["function"]
        for item in build_loop_tool_schemas()
        if item["function"]["name"] == "project_cross_chapter_check"
    )
    assert schema["parameters"]["required"] == ["paths"]
    assert "单章" in schema["description"]


# --- 章序：按阅读序排好再喂 ---


def test_chapters_are_sorted_into_reading_order(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """模型乱序给路径也要按阅读序喂——顺序错了，「时间线先后」这类冲突会被判反。"""

    seen = _stub_checker(monkeypatch, _EMPTY)
    cross_chapter.cross_chapter_review(
        str(serial),
        ["正文/第003章.md", "正文/第001章.md", "正文/第002章.md"],
    )
    names = [chapter["name"] for chapter in seen[0]["chapters"]]
    assert names == [
        "第1章 正文/第001章.md",
        "第2章 正文/第002章.md",
        "第3章 正文/第003章.md",
    ]


def test_non_manuscript_files_sort_after_chapters(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """设定文件没有章序，排在正文之后，不能被当作第 0 章插到最前。"""

    seen = _stub_checker(monkeypatch, _EMPTY)
    cross_chapter.cross_chapter_review(str(serial), ["设定/世界观.md", "正文/第002章.md"])
    assert [chapter["name"] for chapter in seen[0]["chapters"]] == [
        "第2章 正文/第002章.md",
        "设定/世界观.md",
    ]


def test_duplicate_paths_collapse(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """同一章报两遍不该让模型比对自己。"""

    seen = _stub_checker(monkeypatch, _EMPTY)
    with pytest.raises(fs_tools.FsToolError, match="至少需要"):
        cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md", "正文/第001章.md"])
    assert not seen


# --- 输入边界 ---


def test_rejects_single_chapter(serial: Path) -> None:
    """一章无所谓「跨章」。"""

    with pytest.raises(fs_tools.FsToolError, match="至少需要"):
        cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md"])


def test_rejects_too_many_chapters(serial: Path) -> None:
    """章数过多会让结论退回泛泛而谈，显式挡掉并要求分批。"""

    with pytest.raises(fs_tools.FsToolError, match="分批"):
        cross_chapter.cross_chapter_review(
            str(serial), [f"正文/第00{i}章.md" for i in range(1, 4)] * 3
        )


def test_rejects_path_escape(serial: Path) -> None:
    """越界路径拒绝，边界复用 fs_tools。"""

    with pytest.raises(fs_tools.FsToolError):
        cross_chapter.cross_chapter_review(str(serial), ["../外部.md", "正文/第001章.md"])


def test_rejects_blank_chapter(serial: Path) -> None:
    """空文件没有可比对的正文，明说而不是静默跳过凑数。"""

    (serial / "正文" / "第004章.md").write_text("   \n", encoding="utf-8")
    with pytest.raises(fs_tools.FsToolError, match="没有可比对的正文"):
        cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md", "正文/第004章.md"])


# --- 失败显式，不伪造「没有冲突」---


def test_missing_llm_config_is_explicit(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_checker(monkeypatch, LLMConfigError("缺 STORYFORGE_LLM_API_KEY"))
    with pytest.raises(fs_tools.FsToolError, match="未配置 LLM"):
        cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md", "正文/第003章.md"])


def test_llm_failure_does_not_masquerade_as_clean(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """远程失败必须报错——静默返回空 findings 等于告诉作者「查过了，没问题」。"""

    _stub_checker(monkeypatch, LLMError("502 upstream"))
    with pytest.raises(fs_tools.FsToolError, match="没有产出结论"):
        cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md", "正文/第003章.md"])


# --- 输出形状 ---


def test_output_carries_findings_and_truncation_flags(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    finding = {
        "type": "timeline",
        "severity": "high",
        "chapters": ["第1章 正文/第001章.md", "第3章 正文/第003章.md"],
        "finding": "左臂已废却用左手拔剑。",
        "evidence": "第1章「左臂在爆炸里废了」／第3章「他左手拔剑」",
    }
    _stub_checker(monkeypatch, {"findings": [finding], "model": "fake-model", "latency_ms": 9})

    output = cross_chapter.cross_chapter_review(
        str(serial), ["正文/第001章.md", "正文/第003章.md"], focus="左臂"
    )
    assert output["finding_count"] == 1
    assert output["findings"][0]["type"] == "timeline"
    assert output["model"] == "fake-model"
    assert [item["chapter"] for item in output["chapters"]] == [1, 3]
    assert all(item["truncated"] is False for item in output["chapters"])


def test_focus_is_passed_through(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _stub_checker(monkeypatch, _EMPTY)
    cross_chapter.cross_chapter_review(
        str(serial), ["正文/第001章.md", "正文/第003章.md"], focus="玄铁令在谁手上"
    )
    assert seen[0]["focus"] == "玄铁令在谁手上"


def test_oversized_chapter_is_flagged_truncated(serial: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """超出每章预算的部分模型没读到，必须如实标出来。"""

    long_text = "字" * (cross_chapter.PER_CHAPTER_CHAR_BUDGET + 100)
    (serial / "正文" / "第002章.md").write_text(long_text, encoding="utf-8")
    _stub_checker(monkeypatch, _EMPTY)

    output = cross_chapter.cross_chapter_review(str(serial), ["正文/第001章.md", "正文/第002章.md"])
    flags = {item["path"]: item["truncated"] for item in output["chapters"]}
    assert flags["正文/第002章.md"] is True
    assert flags["正文/第001章.md"] is False


# --- 接线护栏：模型发出的 tool_call 真能穿过调度器跑到实现 ---


def test_tool_call_reaches_the_implementation_through_the_loop(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    serial: Path,
) -> None:
    """模型发 project_cross_chapter_check 时，handler 真被调到、证据链真落库。

    只断言 schema 里有这把工具会假绿：spec 加上了但 handler 没注册，模型一调就报
    「未知工具」，作者那头看到的还是「agent 查不了跨章」。
    """

    _enable_loop_env(monkeypatch)
    seen = _stub_checker(
        monkeypatch,
        {
            "findings": [
                {
                    "type": "timeline",
                    "severity": "high",
                    "chapters": ["第1章 正文/第001章.md", "第3章 正文/第003章.md"],
                    "finding": "左臂已废却用左手拔剑。",
                    "evidence": "第1章「左臂在爆炸里废了」／第3章「他左手拔剑」",
                }
            ],
            "model": "fake-model",
            "latency_ms": 9,
        },
    )
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "project_cross_chapter_check",
                            "arguments": json.dumps(
                                {"paths": ["正文/第003章.md", "正文/第001章.md"], "focus": "左臂"}
                            ),
                        },
                    }
                ],
            },
            {"content": "第 1 章说左臂废了，第 3 章却用左手拔剑。", "tool_calls": []},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-cross-chapter",
        project_path=str(serial),
        message="第一章和第三章有没有对不上的地方",
    )

    assert seen, "handler 没被调到——spec 加了但调度器没接上。"
    assert [chapter["name"] for chapter in seen[0]["chapters"]] == [
        "第1章 正文/第001章.md",
        "第3章 正文/第003章.md",
    ]

    result = received[-1]
    assert result["type"] == "agent_result", result
    trace = next(
        item for item in result["tool_trace"] if item["tool_name"] == "project.cross_chapter_check"
    )
    assert trace["status"] == "completed"
    assert trace["output_summary"]["finding_count"] == 1
    assert trace["output_summary"]["chapter_count"] == 2
