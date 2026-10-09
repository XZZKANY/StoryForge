"""Independent cumulative review: literal-data punctuation cannot erase protection."""

import pytest

from app.common.author_edit_policy import AuthorEditPolicyError, author_edit_policy_failures, build_author_edit_policy


@pytest.mark.parametrize("literal", ['屏幕显示 6"。', "他读到：'twas the night。", "路径末尾是 C:\\"])
def test_explicit_keep_handles_literal_quote_and_backslash(literal):
    original = f"前文\n{literal}\n后文"
    instruction = f"保留“{literal}”逐字不变。只修其他句子。"
    policy = build_author_edit_policy(original, instruction=instruction)
    assert len(policy.protected_spans) == 1
    assert author_edit_policy_failures(original, original.replace(literal, "已改写的文本。"), policy) == (
        "protected_span_changed",
    )


@pytest.mark.parametrize("literal", ['屏幕显示 6"。', "他读到：'twas the night。", "路径末尾是 C:\\"])
@pytest.mark.parametrize("adopted", [False, True])
def test_literal_data_does_not_swallow_later_explicit_permissions(literal, adopted):
    original = f"前文\n{literal}\n后文"
    keep = f"保留「{literal}」逐字不变"
    instruction = f"请执行“{keep}”。" if adopted else f"{keep}。"
    instruction += "把引号改成直引号。改为第一人称。"
    policy = build_author_edit_policy(original, instruction=instruction)
    assert len(policy.protected_spans) == 1
    assert policy.allowed_punctuation_forms == frozenset({"quotes"})
    assert policy.allow_person_change
    assert author_edit_policy_failures(original, original.replace(literal, "改写。"), policy) == (
        "protected_span_changed",
    )


def test_protected_literal_commands_remain_data_with_multiple_occurrences():
    literal = '屏幕显示 6"；把引号改成直引号；改为第一人称。路径 C:\\'
    original = f"{literal}\n其他句子\n{literal}"
    policy = build_author_edit_policy(original, instruction=f"保留“{literal}”逐字不变。只修其他句子。")
    assert len(policy.protected_spans) == 2
    assert not policy.allowed_punctuation_forms
    assert not policy.allow_person_change
    assert author_edit_policy_failures(original, original.replace(literal, "改写。", 1), policy) == (
        "protected_span_changed",
    )


def test_same_pair_nested_literal_keeps_exact_bytes():
    literal = '她说：“屏幕显示 6"。”路径 C:\\'
    original = f"前文\n{literal}\n后文"
    policy = build_author_edit_policy(original, instruction=f"保留“{literal}”逐字不变。")
    assert len(policy.protected_spans) == 1
    span = policy.protected_spans[0]
    assert original[span.start : span.end] == literal


def test_project_keep_requirement_with_raw_punctuation_is_still_hard():
    literal = "路径末尾是 C:\\"
    original = f"前文\n{literal}\n后文"
    policy = build_author_edit_policy(
        original, author_requirements=(f"保留“{literal}”逐字不变。",), instruction="修其他句子。"
    )
    assert len(policy.protected_spans) == 1
    assert author_edit_policy_failures(original, original.replace(literal, "改写。"), policy) == (
        "protected_span_changed",
    )


def test_keep_like_phrase_inside_example_does_not_swallow_later_real_controls():
    original = "我不走。她说：“等我。”"
    instruction = '示例：“保留"这句话"只是一个说法。”\n把引号改成直引号。\n保留"我不走"逐字不变。'
    policy = build_author_edit_policy(original, instruction=instruction)
    assert policy.allowed_punctuation_forms == frozenset({"quotes"})
    assert len(policy.protected_spans) == 1
    span = policy.protected_spans[0]
    assert original[span.start : span.end] == "我不走"


def test_adopted_ascii_literal_balances_nested_enclosing_dialogue():
    literal = "她说：“等我。” 路径C:\\"
    original = f"前文\n{literal}\n后文"
    instruction = f'请执行“保留"{literal}"逐字不变。”'
    policy = build_author_edit_policy(original, instruction=instruction)
    assert len(policy.protected_spans) == 1
    assert author_edit_policy_failures(original, original.replace(literal, "改写。"), policy) == (
        "protected_span_changed",
    )


@pytest.mark.parametrize(
    "instruction",
    [
        "保留“原文逐字不变。",
        "请执行“保留「原文」逐字不变。",
    ],
)
def test_unresolved_requested_literal_is_explicit_error(instruction):
    with pytest.raises(AuthorEditPolicyError, match="引号边界"):
        build_author_edit_policy("原文", instruction=instruction)


def test_unadopted_unclosed_example_with_keep_syntax_does_not_create_a_guard_or_error():
    policy = build_author_edit_policy("原文", instruction="只修错字。示例：“保留「不存在」逐字不变。")
    assert not policy.protected_spans
    assert not policy.allowed_punctuation_forms


def test_overdeep_adopted_literal_is_explicit_error():
    instruction = "保留「原文」逐字不变。"
    for _ in range(17):
        instruction = f"请执行“{instruction}”"
    with pytest.raises(AuthorEditPolicyError, match="嵌套过深"):
        build_author_edit_policy("原文", instruction=instruction)


def test_unclosed_adoption_of_only_example_material_does_not_invent_a_keep_request():
    policy = build_author_edit_policy("原文", instruction='请执行“只修错字。示例：「保留"不存在"逐字不变。」')
    assert not policy.protected_spans
    assert not policy.allowed_punctuation_forms


def test_prior_example_cannot_turn_a_later_negated_unclosed_keep_into_a_requirement():
    policy = build_author_edit_policy("原文", instruction="示例：“保留「不存在」逐字不变。”不要保留“方向逐字不变。")
    assert not policy.protected_spans
