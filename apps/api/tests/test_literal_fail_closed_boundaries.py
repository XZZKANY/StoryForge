import pytest

from app.common.author_edit_policy import AuthorEditPolicyError, build_author_edit_policy


@pytest.mark.parametrize(
    "instruction",
    [
        "逐字保留“原文",
        "保留“原文逐字不变",
        "请执行“逐字保留「原文」",
        ("请执行“" * 16) + "逐字保留「原文」" + ("”" * 16),
    ],
)
def test_recognized_unresolved_keep_fails_closed(instruction):
    with pytest.raises(AuthorEditPolicyError):
        build_author_edit_policy("原文", instruction=instruction)


@pytest.mark.parametrize(
    "instruction",
    [
        "不要逐字保留“原文",
        "示例：“逐字保留「不存在",
        "请执行“示例：「逐字保留『不存在』」",
        "他说“这只是未结束的普通引用",
        "请执行“这是未结束的普通规则",
    ],
)
def test_non_authority_or_negated_unclosed_material_is_inert(instruction):
    policy = build_author_edit_policy("原文", instruction=instruction)
    assert not policy.protected_spans
    assert not policy.allowed_punctuation_forms
    assert not policy.allow_person_change
