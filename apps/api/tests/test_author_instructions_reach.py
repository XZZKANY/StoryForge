"""作者自定义指令触达护栏：`.storyforge/agent-instructions.md` 必须进产字路径。

背景（2026-07-28 诊断）：该文件改前只被 chat 循环读取，而循环自己不产字——它产字靠调
file.revise / file.create / prose.continue，那三条各用自己的 system prompt，作者指令
一律不带。结论：作者写进这个文件的偏好**影响不到任何一个生成字符**，功能看着像生效、
结构上不可能生效。本文件把"三条生成路径都带"钉成可证伪断言。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.common.author_voice import (
    GENERATION_PREFIX,
    MAX_CHARS,
    append_author_instructions_to_system_prompt,
    read_author_instructions,
)


@pytest.fixture()
def project_with_instructions(tmp_path: Path) -> Path:
    storyforge = tmp_path / ".storyforge"
    storyforge.mkdir()
    (storyforge / "agent-instructions.md").write_text(
        "叙述一律用第三人称限知视角。禁止出现「系统提示」这类游戏化术语。",
        encoding="utf-8",
    )
    return tmp_path


def test_reads_instructions_from_project(project_with_instructions: Path) -> None:
    text = read_author_instructions(str(project_with_instructions))
    assert text is not None
    assert "第三人称限知视角" in text


@pytest.mark.parametrize(
    "project_path",
    [None, "", "   ", "/nonexistent/path/does/not/exist"],
    ids=["none", "empty", "blank", "missing-dir"],
)
def test_absent_project_yields_no_injection(project_path: str | None) -> None:
    """缺项目根 / 目录不存在一律 None：这是加分项，绝不能拖垮生成。"""

    assert read_author_instructions(project_path) is None


def test_missing_file_yields_none(tmp_path: Path) -> None:
    assert read_author_instructions(str(tmp_path)) is None


def test_empty_file_yields_none(tmp_path: Path) -> None:
    storyforge = tmp_path / ".storyforge"
    storyforge.mkdir()
    (storyforge / "agent-instructions.md").write_text("   \n\n", encoding="utf-8")
    assert read_author_instructions(str(tmp_path)) is None


def test_overlong_instructions_are_truncated_with_marker(tmp_path: Path) -> None:
    storyforge = tmp_path / ".storyforge"
    storyforge.mkdir()
    (storyforge / "agent-instructions.md").write_text("语" * (MAX_CHARS + 500), encoding="utf-8")
    text = read_author_instructions(str(tmp_path))
    assert text is not None
    assert "已截断" in text, "截断必须留痕，否则作者不知道后半段被丢了"


def test_generation_prefix_is_stronger_than_conversation_wording() -> None:
    """产字路径措辞必须是"逐条遵循"而非"尽量遵循"。

    生成时作者指令是硬约束（"这个人物不说某个词"必须照办）；沿用对话档的"尽量"
    会让模型把作者的硬要求当可选偏好。
    """

    assert "逐条遵循" in GENERATION_PREFIX
    assert "尽量遵循" not in GENERATION_PREFIX


def test_append_is_noop_without_instructions(tmp_path: Path) -> None:
    assert append_author_instructions_to_system_prompt("原样", str(tmp_path)) == "原样"


def test_append_puts_instructions_last(project_with_instructions: Path) -> None:
    """指令排在 system prompt 末尾：近因位置对生成影响最强。"""

    result = append_author_instructions_to_system_prompt(
        "通用创作准则在前。", str(project_with_instructions)
    )
    assert result.startswith("通用创作准则在前。")
    assert result.index(GENERATION_PREFIX) > result.index("通用创作准则在前。")
    assert "第三人称限知视角" in result


def test_three_generation_paths_call_the_injector() -> None:
    """revise / create / continue 三条都必须经 append_author_instructions_to_system_prompt。

    直接传裸 `_REVISE_SYSTEM_PROMPT` / `_DRAFT_SYSTEM_PROMPT` /
    `continuation.CONTINUE_SYSTEM_PROMPT` 即红——那正是改前的形状。
    """

    source = (
        Path(__file__).resolve().parents[1] / "app" / "domains" / "assistant" / "service.py"
    ).read_text(encoding="utf-8")
    for bare in (
        "system_prompt=_REVISE_SYSTEM_PROMPT,",
        "system_prompt=_DRAFT_SYSTEM_PROMPT,",
        "system_prompt=continuation.CONTINUE_SYSTEM_PROMPT,",
        '{"role": "system", "content": continuation.CONTINUE_SYSTEM_PROMPT}',
    ):
        assert bare not in source, f"生成路径仍在传裸 system prompt，作者指令进不去：{bare}"
    assert source.count("append_author_instructions_to_system_prompt(") >= 4


def test_generation_requests_accept_project_root() -> None:
    """revise / draft 的 payload 必须能带 project_root，否则服务层无处定位指令文件。"""

    from app.domains.assistant.schemas import AssistantDraftRequest, AssistantReviseRequest

    assert "project_root" in AssistantReviseRequest.model_fields
    assert "project_root" in AssistantDraftRequest.model_fields
