import pytest

from app.common.author_edit_policy import author_edit_policy_failures, build_author_edit_policy


@pytest.mark.parametrize("opening,closing", [("“", "”"), ("「", "」"), ("『", "』"), ('"', '"')])
@pytest.mark.parametrize("literal", ['屏幕显示 6"。', "他读到：'twas the night。", "路径末尾是 C:\\"])
def test_legacy_keep_delimiters_with_raw_literal_punctuation(opening, closing, literal):
    original = f"前文\n{literal}\n后文"
    policy = build_author_edit_policy(original, instruction=f"保留{opening}{literal}{closing}逐字不变。只修其他句子。")
    assert len(policy.protected_spans) == 1
    assert author_edit_policy_failures(original, original.replace(literal, "改写。"), policy) == (
        "protected_span_changed",
    )


@pytest.mark.parametrize(
    "quoted",
    [
        '“示例要求：保留「屏幕显示 6\\"。」逐字不变；把引号改成直引号。”',
        "“示例要求：保留「路径 C:\\」逐字不变；改为第一人称。”",
        '“不要保留「屏幕显示 6\\"。」逐字不变；把引号改成直引号。”',
    ],
)
def test_example_with_keep_syntax_cannot_create_authority(quoted):
    policy = build_author_edit_policy(
        "他走出门。", instruction=f"只修错字，不要改引号和人称。示例：{quoted}这只是材料。"
    )
    assert not policy.protected_spans
    assert not policy.allowed_punctuation_forms
    assert not policy.allow_person_change
