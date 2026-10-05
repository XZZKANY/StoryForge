"""修订能力只依赖显式值和生成 callable；不建立 client/engine/session。"""

from __future__ import annotations

import builtins
import json
import os
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from app.common.llm_client import LLMError
from app.domains.agent_runs.patches import evaluate_polish_candidate
from app.domains.assistant.revision import (
    EXPANSION_POLISH_GATE_CONFIG,
    RevisionContextFile,
    RevisionInput,
    RevisionQualityRejected,
    build_revision_prompt,
    instruction_authorizes_expansion,
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
        + "\n本次编辑政策（writer、后处理与本地候选共用）：\n"
        + json.dumps({'version': 'author-edit-v1', 'source_sha256': '14b02b0660cca15eb4ccee5c73e3f4120fef449b7fa0aeb56406892c3d199d4d', 'author_requirement_count': 0, 'baseline_present': False, 'allowed_punctuation_forms': [], 'preserve_repeated_marks': False, 'allow_person_change': False, 'protected_span_count': 0}, ensure_ascii=False)
        + "\n当前真实作者要求：\n改一句\n"
        + "以下是待修订的正文，请按指令修订后整体返回，只返回你收到的这段：\n<<<FILE\n他推开门。\nFILE>>>"
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


# 局部扩写：短窗原文 + 明显加长的候选，整窗比例远超 polish 默认上界（1.15）。
EXPANSION_INSTRUCTION = "把这一句扩写得更具体：补上门的样子和它发出的声音"
NEUTRAL_INSTRUCTION = "按下面的意图润色锚定文本。"
SHORT_ORIGINAL = "他把门推开。"
EXPANDED_CANDIDATE = "他把那扇旧木门缓缓推开，门轴发出一声长长的吱呀。"
# 一个自然、无文风回归的长候选：整窗比例约 6.8x，只用来测比例闸口径。
LONG_CANDIDATE = "他把那扇斑驳陈旧的木门缓缓推开，门轴发出一声悠长而低沉的吱呀，像是整座老屋在叹气。"
# 行间 Ctrl+K 的真实形态：作者指令 + 最小改动契约 + 末尾拼进的锚定正文块（供后端剥离）。
ANCHOR_BODY_WITH_KEYWORD = "他把门推开，胸口的郁结像要缓缓展开。"
INLINE_INSTRUCTION_WITH_ANCHOR = "\n\n".join(
    [
        NEUTRAL_INSTRUCTION,
        "最小改动约束（必须严格遵守）：\n1. 只改动锚定文本。",
        f"锚定文本（选中的这段）：\n<<<ANCHOR\n{ANCHOR_BODY_WITH_KEYWORD}\nANCHOR>>>",
    ]
)


def test_expansion_instruction_authorizes_growth_past_whole_window_ratio():
    source = request(content=SHORT_ORIGINAL, instruction=EXPANSION_INSTRUCTION, quality_gate="polish")

    result = revise_text(source, generate=lambda **_kw: {"content": EXPANDED_CANDIDATE})

    assert result.after == EXPANDED_CANDIDATE
    assert result.quality_gate is not None and result.quality_gate.passed
    assert result.quality_gate.metrics["char_ratio"] > 1.15


def test_expansion_instruction_without_quality_gate_is_not_gated():
    # T08-F3：quality_gate=None 的 file.revise 路径完全不过门禁（与改动前一致），
    # 即便指令里出现扩写关键词也不新开 polish 档。
    source = request(content=SHORT_ORIGINAL, instruction=EXPANSION_INSTRUCTION)

    result = revise_text(source, generate=lambda **_kw: {"content": EXPANDED_CANDIDATE})

    assert result.after == EXPANDED_CANDIDATE
    assert result.quality_gate is None


def test_anchor_body_keyword_does_not_authorize_expansion():
    # T08-F1：行间指令把锚定正文拼进 instruction；正文里出现「展开」这类叙事高频词
    # 不该被当成扩写授权，中性润色仍受 1.15 整窗上界约束。
    source = request(content=SHORT_ORIGINAL, instruction=INLINE_INSTRUCTION_WITH_ANCHOR, quality_gate="polish")

    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(source, generate=lambda **_kw: {"content": LONG_CANDIDATE})

    assert "word_count_drift" in caught.value.gate.reasons
    assert caught.value.gate.metrics["char_ratio"] > 5.0


def test_negated_expansion_instruction_is_not_authorized():
    # T08-F2：否定语境下的扩写词不构成授权，polish 档按默认比例上界收紧。
    negated = "不要扩写，只改错别字：把这一句里的错字改掉。"
    source = request(content=SHORT_ORIGINAL, instruction=negated, quality_gate="polish")

    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(source, generate=lambda **_kw: {"content": LONG_CANDIDATE})

    assert "word_count_drift" in caught.value.gate.reasons


@pytest.mark.parametrize(
    "phrase",
    ["把这一句扩写一下", "请加长这一段", "展开写", "补充细节", "丰富描写", "细化场景"],
)
def test_instruction_authorizes_expansion_for_plain_keywords(phrase: str) -> None:
    assert instruction_authorizes_expansion(phrase) is True


@pytest.mark.parametrize(
    "phrase",
    ["不要扩写，只改错别字", "别补充内容", "别扩写这段", "不用加长", "不必展开", "先别扩写", "暂不补充", "先不细化"],
)
def test_instruction_does_not_authorize_negated_keywords(phrase: str) -> None:
    assert instruction_authorizes_expansion(phrase) is False


@pytest.mark.parametrize(
    "phrase",
    ["请特别展开这段心理描写", "请分别展开两个人的视角", "个别展开描写一下"],
)
def test_instruction_authorizes_expansion_for_compound_words_with_bie(phrase: str) -> None:
    # T08-F1：「特别/分别/个别」里的「别」是与前字构词，不是否定；正当扩写必须授权。
    assert instruction_authorizes_expansion(phrase) is True


def test_instruction_with_unclosed_anchor_block_does_not_authorize_expansion() -> None:
    # T08-F2：前端整串 slice(0, 4000) 会把末尾 ANCHOR>>> 截掉，成对剥离失效后锚定正文里的
    # 「展开」会泄漏成扩写授权；未闭合时保守剥到结尾，宁可判不授权。
    instruction = "\n\n".join(
        [
            NEUTRAL_INSTRUCTION,
            "最小改动约束（必须严格遵守）：\n1. 只改动锚定文本。",
            f"锚定文本（选中的这段）：\n<<<ANCHOR\n{ANCHOR_BODY_WITH_KEYWORD}",
        ]
    )
    assert instruction_authorizes_expansion(instruction) is False


def test_unclosed_anchor_body_keyword_still_caps_whole_window_growth() -> None:
    instruction = "\n\n".join(
        [
            NEUTRAL_INSTRUCTION,
            "最小改动约束（必须严格遵守）：\n1. 只改动锚定文本。",
            f"锚定文本（选中的这段）：\n<<<ANCHOR\n{ANCHOR_BODY_WITH_KEYWORD}",
        ]
    )
    source = request(content=SHORT_ORIGINAL, instruction=instruction, quality_gate="polish")

    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(source, generate=lambda **_kw: {"content": LONG_CANDIDATE})

    assert "word_count_drift" in caught.value.gate.reasons



def test_instruction_authorizes_expansion_ignores_anchored_body() -> None:
    assert instruction_authorizes_expansion(INLINE_INSTRUCTION_WITH_ANCHOR) is False


def test_neutral_polish_instruction_still_caps_whole_window_growth():
    source = request(content=SHORT_ORIGINAL, instruction=NEUTRAL_INSTRUCTION, quality_gate="polish")

    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(source, generate=lambda **_kw: {"content": EXPANDED_CANDIDATE})

    assert "word_count_drift" in caught.value.gate.reasons


def test_expansion_instruction_keeps_structure_and_person_protections():
    heading_original = "# 标题\n\n他把门推开。"
    heading_source = request(content=heading_original, instruction=EXPANSION_INSTRUCTION, quality_gate="polish")
    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(
            heading_source,
            generate=lambda **_kw: {"content": "# 标题变了\n\n他把那扇旧木门缓缓推开。"},
        )
    assert "protected_structure_changed" in caught.value.gate.reasons

    person_original = "# 标题\n\n" + "我推开门。" * 6
    person_source = request(content=person_original, instruction=EXPANSION_INSTRUCTION, quality_gate="polish")
    with pytest.raises(RevisionQualityRejected) as caught:
        revise_text(person_source, generate=lambda **_kw: {"content": person_original.replace("我", "他")})
    assert "narrative_person_changed" in caught.value.gate.reasons


def test_expansion_instruction_keeps_static_prose_regression_advisory():
    original = "# 标题\n\n他推开门，握紧刀，转身看向巷口，又停下。"
    candidate = "# 标题\n\n他不禁推开门，心中五味杂陈，握紧刀，转身看向巷口，又停下。"
    source = request(content=original, instruction=EXPANSION_INSTRUCTION, quality_gate="polish")

    result = revise_text(source, generate=lambda **_kw: {"content": candidate})

    assert result.after == candidate
    assert result.quality_gate.passed
    assert "prose_issue_regressed" in result.quality_gate.advisories


def test_expansion_config_still_rejects_entity_drift():
    # 实体保护只在 gate 层可用（RevisionInput 不带实体表）；授权扩写配置不得放开这一闸。
    original = "# 标题\n\n" + "林岚推开门。" * 6
    candidate = original.replace("林岚", "林蓝")

    result = evaluate_polish_candidate(
        original, candidate, protected_entities=("林岚",), config=EXPANSION_POLISH_GATE_CONFIG
    )

    assert result.passed is False
    assert "protected_entity_changed:林岚" in result.reasons



@pytest.mark.parametrize(
    "phrase",
    ["无需展开", "无须扩写", "切忌扩写", "禁止扩写", "不准扩写", "不许扩写", "切勿展开", "避免展开"],
)
def test_instruction_does_not_authorize_expansion_for_extended_negation_words(phrase: str) -> None:
    # T08：否定闸词表补齐「无需/无须/切忌/禁止/不准/不许/切勿/避免」，这些否定不构成扩写授权。
    assert instruction_authorizes_expansion(phrase) is False


@pytest.mark.parametrize(
    "phrase",
    ["不要立刻展开", "不必再细化了", "无需进一步补充", "禁止顺便展开描写"],
)
def test_instruction_does_not_authorize_expansion_when_negation_is_spaced(phrase: str) -> None:
    # T08：否定标记与关键词之间夹少量非动词成分（如「立刻」「再」「进一步」）仍属否定语境。
    assert instruction_authorizes_expansion(phrase) is False
