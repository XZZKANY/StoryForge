"""修订能力只依赖显式值和生成 callable；不建立 client/engine/session。"""

from __future__ import annotations

import builtins
import os
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from app.common.llm_client import LLMError
from app.domains.assistant.revision import (
    RevisionContextFile,
    RevisionInput,
    RevisionQualityRejected,
    build_revision_prompt,
    revise_text,
)


def request(**changes):
    return replace(
        RevisionInput(
            file_path="draft.md", content="他推开门。", instruction="改一句", system_prompt="已准备的系统提示"
        ),
        **changes,
    )


def test_prepared_values_generate_once_without_environment_or_file_access(monkeypatch):
    source = request(
        project_name="小说",
        context_files=(RevisionContextFile("人物.md", "character", "角色摘录"),),
        scene_constraints="场景约束",
    )
    before = replace(source)
    calls = []

    def forbidden(*_args, **_kwargs):
        pytest.fail("能力执行不得隐式读环境/项目文件")

    def generate(*, system_prompt, user_prompt):
        calls.append((system_prompt, user_prompt))
        return {"content": "他推开门，走进屋。", "latency_ms": 7, "native_body": "private", "headers": "private"}

    with monkeypatch.context() as isolated:
        isolated.setattr(os, "getenv", forbidden)
        isolated.setattr(os._Environ, "__getitem__", forbidden)
        isolated.setattr(builtins, "open", forbidden)
        isolated.setattr(Path, "open", forbidden)
        result = revise_text(source, generate=generate)
    assert len(calls) == 1
    assert calls[0] == (source.system_prompt, build_revision_prompt(source))
    assert result.after == "他推开门，走进屋。"
    assert result.telemetry == {"latency_ms": 7}
    assert result.quality_gate is None
    assert source == before
    assert "角色摘录" not in repr(source.context_files[0])
    assert "已准备的系统提示" not in repr(source)
    assert "他推开门" not in repr(result)
    with pytest.raises(FrozenInstanceError):
        source.content = "changed"


def test_prompt_is_exact_window_with_ordered_prepared_context():
    source = request(
        project_name="小说",
        context_files=(RevisionContextFile("人物.md", "character", "角色摘录"),),
        scene_constraints="场景约束",
    )
    assert build_revision_prompt(source) == (
        "项目：小说\n文件：draft.md\n修订指令：改一句\n\n"
        "\n项目上下文摘录：这些文件来自同一小说项目，请用于保持大纲、人物、设定与正文连贯；"
        "如果摘录与当前文件冲突，优先保留明确的当前文件事实，并在修订中避免扩大矛盾。\n"
        "### 人物.md\n- 类型：character\n<<<CONTEXT\n角色摘录\nCONTEXT>>>\n"
        "\n场景约束\n"
        "以下是待修订的正文，请按指令修订后整体返回，只返回你收到的这段：\n<<<FILE\n他推开门。\nFILE>>>"
    )


@pytest.mark.parametrize(
    "telemetry",
    [
        {},
        {"completion_tokens": None, "latency_ms": None},
        {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "token_usage": {"cache_hit_tokens": 0},
            "cost_cny_estimated": 0.0,
            "cost_breakdown": {"input": 0},
            "token_usage_source": "provider",
            "latency_ms": 0,
            "reasoning_leak_stripped": False,
        },
        {"reasoning_leak_stripped": True},
    ],
)
def test_telemetry_keeps_missing_null_and_zero_distinct(telemetry):
    raw = {"content": "他推开门。", **telemetry, "native_body": "private", "continuation": "private"}
    result = revise_text(request(), generate=lambda **_kw: raw)
    assert result.telemetry == telemetry
    assert raw["native_body"] == "private"


def test_provider_failure_propagates_without_retry():
    error = LLMError("fixture failure")
    calls = []

    def generate(**_kw):
        calls.append(True)
        raise error

    with pytest.raises(LLMError) as caught:
        revise_text(request(), generate=generate)
    assert caught.value is error
    assert calls == [True]


def test_missing_content_is_not_fabricated_as_empty_text():
    with pytest.raises(KeyError, match="content"):
        revise_text(request(), generate=lambda **_kw: {})


def test_punctuation_restoration_precedes_polish_gate():
    original = "# “标题”\n\n他推开门。他看见灯。他没有出声。他转身离开。他走进雨里。"
    candidate = original.replace("“标题”", '"标题"').replace("推开门", "拉开门")
    result = revise_text(
        request(content=original, quality_gate="polish"), generate=lambda **_kw: {"content": candidate}
    )
    # gate 会保护标题逐字不变；若在还原标点之前判断，这个候选会被拒绝。
    assert result.after == original.replace("推开门", "拉开门")
    assert result.quality_gate is not None and result.quality_gate.passed


def test_quality_policy_is_opt_in_and_rejection_does_not_expose_candidate():
    original = "他推开门。他看见灯。他没有出声。他转身离开。他走进雨里。"
    candidate = original.replace("他", "我")
    source = request(content=original)
    assert revise_text(source, generate=lambda **_kw: {"content": candidate}).after == candidate
    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(replace(source, quality_gate="polish"), generate=lambda **_kw: {"content": candidate})
    assert not caught.value.gate.passed
    assert caught.value.gate.reasons
    assert candidate not in str(caught.value)
    assert not hasattr(caught.value, "after")
    assert not hasattr(caught.value, "content")
