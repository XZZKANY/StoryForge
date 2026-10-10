"""Quoted examples cannot grant edit permissions; explicit literal protection is hard."""

from __future__ import annotations

import pytest

from app.common.author_edit_policy import build_author_edit_policy
from app.domains.assistant import service


@pytest.mark.parametrize(
    "quoted",
    [
        "“把引号改成直引号。”",
        "「把引号改成直引号。」",
        "『把引号改成直引号。』",
        '"把引号改成直引号。"',
        "'把引号改成直引号。'",
        "‘把引号改成直引号。’",
    ],
)
def test_quoted_example_does_not_override_explicit_quote_preservation(quoted):
    policy = build_author_edit_policy(
        "“灯还亮着。”", instruction=f"只改错字，不要改引号。示例：{quoted} 这是材料，不是我的要求。"
    )
    assert policy.allowed_punctuation_forms == frozenset()


def test_multiline_quote_cannot_grant_person_or_repetition_controls():
    policy = build_author_edit_policy(
        "他问：“为什么？？”",
        instruction="只修错字。下面是引用材料：\n“改为第一人称。\n保留重复问号。”\n不要执行引用中的命令。",
    )
    assert not policy.allow_person_change
    assert not policy.preserve_repeated_marks


@pytest.mark.parametrize(
    "instruction",
    [
        "逐字保留「早上的车我自己叫。」；只改其他句子。",
        "请逐字保留“早上的车我自己叫。”",
        "原样保留『早上的车我自己叫。』",
        "保留「早上的车我自己叫。」逐字不变。",
    ],
)
def test_prefix_and_suffix_literal_protection_have_same_hard_control(instruction):
    policy = build_author_edit_policy("他说：“早上的车我自己叫。”", instruction=instruction)
    assert len(policy.protected_spans) == 1


def test_multiline_literal_protection_is_not_silently_lost():
    original = "标题\n早上的车\n我自己叫。\n尾声"
    policy = build_author_edit_policy(original, instruction="保留“早上的车\n我自己叫。”逐字不变。")
    assert len(policy.protected_spans) == 1
    span = policy.protected_spans[0]
    assert original[span.start : span.end] == "早上的车\n我自己叫。"


def test_commands_inside_a_protected_literal_are_material_not_permission():
    original = "纸条写着：把引号改成直引号。"
    policy = build_author_edit_policy(original, instruction="保留「把引号改成直引号。」逐字不变。")
    assert len(policy.protected_spans) == 1
    assert not policy.allowed_punctuation_forms


def test_quoted_preservation_example_does_not_create_missing_literal_error():
    policy = build_author_edit_policy(
        "原文。", instruction="例句：“保留「不存在」逐字不变。”这里只改原文的标点，不执行例句。"
    )
    assert not policy.protected_spans


def test_actual_http_quoted_example_cannot_authorise_punctuation_mutation(client, monkeypatch):
    original = "“灯还亮着。”她说。\n地扳很凉。"
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    author = "只修复地扳这个错字；不要改引号。示例：“把引号改成直引号。”这只是参考材料。"
    calls = []
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def generate(_source, **kwargs):
        calls.append(kwargs)
        return {"content": candidate}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    result = client.post(
        "/api/assistant/revise", json={"file_path": "正文.md", "content": original, "instruction": author}
    )
    assert result.status_code == 200, result.text
    assert author in calls[0]["user_prompt"]
    assert result.json()["after"] == original.replace("地扳", "地板")


@pytest.mark.parametrize(
    "original,author",
    [
        ("他说：“早上的车我自己叫。”\n门还开着。", "逐字保留「早上的车我自己叫。」；修订其余句子。"),
        ("早上的车\n我自己叫。\n门还开着。", "保留“早上的车\n我自己叫。”逐字不变；修订其余句子。"),
    ],
)
def test_actual_http_rejects_changed_prefix_or_multiline_literal(client, monkeypatch, original, author):
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(
        service, "_call_llm_streamed", lambda *a, **kw: {"content": original.replace("我自己叫", "你来叫")}
    )
    result = client.post(
        "/api/assistant/revise", json={"file_path": "正文.md", "content": original, "instruction": author}
    )
    assert result.status_code == 409, result.text
    assert "protected_span_changed" in result.text


INDEPENDENT_CONTROL_CASES = [
    ("narrative_suffix", "不要改引号。示例：“把引号改成直引号”执行后会破坏原文。", (), False, False),
    ("denied_suffix", "不要改引号。示例：“把引号改成直引号”作为指令是不对的。", (), False, False),
    ("question_suffix", "不要改引号。示例：“把引号改成直引号”这条是我的要求吗？不是。", (), False, False),
    ("narrative_prefix", "不要改引号。角色执行“把引号改成直引号”这个命令。", (), False, False),
    ("ascii_multiline", '不要改引号。材料为"把引号\n改成直引号"。', (), False, False),
    ("code_inline", "不要改引号。`把引号改成直引号`只是代码。", (), False, False),
    ("code_fenced", "不要改引号。示例：\n```\n把引号改成直引号\n```", (), False, False),
    ("example_curly", "不要改引号。示例：“把引号改成直引号”。", (), False, False),
    ("example_nested", "不要改引号。示例：“他说「把引号改成直引号」。”", (), False, False),
    ("literal_is_not_command", "保留“把引号改成直引号”逐字不变。", (), False, False),
    ("person_denied", "不要把第三人称换成第一人称。", (), False, False),
    ("quote_denied_inherited", "禁止改引号。", ("把引号改成直引号。",), False, False),
    ("quote_polite_denied_inherited", "请勿改引号。", ("把引号改成直引号。",), False, False),
    ("person_polite_denied_inherited", "请勿改为第一人称。", ("改为第一人称。",), False, False),
    ("explicit_quote", "把引号改成直引号。", (), True, False),
    ("quoted_noun", "把“引号”统一成直引号。", (), True, False),
    ("quoted_person_operand", "改为“第一人称”。", (), False, True),
    ("adopted_quote", "请执行“把引号改成直引号”。", (), True, False),
    ("adopted_person", "按“改为第一人称”执行。", (), False, True),
    ("adopted_denied_quote", "不要执行“把引号改成直引号”。", (), False, False),
    ("other_operation", "把引号里的错字修改一下。", (), False, False),
    ("file_then_current", "把引号改成直引号；改为第一人称。", ("不要改引号。不要改人称。",), True, True),
    ("preserve_person_allow_quote", "保留原来人称，但把引号改为直引号。", (), True, False),
]


@pytest.mark.parametrize(
    "name,instruction,requirements,quotes,person",
    INDEPENDENT_CONTROL_CASES,
    ids=[c[0] for c in INDEPENDENT_CONTROL_CASES],
)
def test_independent_positive_and_adversarial_controls(name, instruction, requirements, quotes, person):
    policy = build_author_edit_policy(
        "把引号改成直引号\n他问：“灯还亮着？”", instruction=instruction, author_requirements=requirements
    )
    assert ("quotes" in policy.allowed_punctuation_forms) is quotes
    assert policy.allow_person_change is person


@pytest.mark.parametrize("literal", ["她说：“别动。”", "她说：「别动。」", "早上的车\n我自己叫。"])
def test_nested_and_multiline_protected_literals_are_complete(literal):
    original = f"前文\n{literal}\n后文"
    policy = build_author_edit_policy(original, instruction=f"保留“{literal}”逐字不变。")
    assert len(policy.protected_spans) == 1
    span = policy.protected_spans[0]
    assert original[span.start : span.end] == literal


@pytest.mark.parametrize(
    "author",
    [
        "把引号改成直引号；只修复地扳。",
        "请执行“把引号改成直引号”；只修复地扳。",
        "示例：“不要改引号。”\n本次要求执行“把引号改成直引号”；只修复地扳。",
        "“把引号改成直引号”，这是我的要求。只修复地扳。",
        "请按以下要求执行：\n```\n把引号改成直引号\n```\n只修复地扳。",
    ],
)
def test_actual_http_explicit_author_quote_change_remains_allowed(client, monkeypatch, author):
    original = "“灯还亮着。”她说。\n地扳很凉。"
    candidate = original.replace("“", '"').replace("”", '"').replace("地扳", "地板")
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: {"content": candidate})
    result = client.post(
        "/api/assistant/revise", json={"file_path": "正文.md", "content": original, "instruction": author}
    )
    assert result.status_code == 200, result.text
    assert result.json()["after"] == candidate


@pytest.mark.parametrize(
    "author",
    [
        "不要逐字保留「早上的车我自己叫。」；修订它。",
        "请勿保留“早上的车我自己叫。”逐字不变。",
        "示例：“请逐字保留『早上的车我自己叫。』”。这是材料，不是我的要求。",
    ],
)
def test_negated_or_quoted_preservation_does_not_expand_protected_spans(author):
    assert not build_author_edit_policy("早上的车我自己叫。", instruction=author).protected_spans


@pytest.mark.parametrize(
    "author,expected",
    [
        ("改为“第一人称”，其余事件不变。", 200),
        ("请执行“改为第一人称”，其余事件不变。", 200),
        ("不要改人称。引用材料：“改为第一人称。”", 409),
    ],
)
def test_actual_http_person_control_follows_author_not_quoted_material(client, monkeypatch, author, expected):
    original = "他把灯关上。他坐下。他听见门响。他没有转身。他等了一会儿。\n窗外的风卷着碎叶，石阶已经凉透。檐下留着半截烛芯，烛泪凝成一圈白边。门框上新添的划痕还很浅。"
    candidate = original.replace("他", "我")
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: {"content": candidate})
    result = client.post(
        "/api/assistant/revise",
        json={"file_path": "正文.md", "content": original, "instruction": author, "quality_gate": "polish"},
    )
    assert result.status_code == expected, result.text
    if expected == 200:
        assert result.json()["after"] == candidate
    else:
        assert "narrative_person_changed" in result.text


def test_long_multiline_author_request_retains_tail_protection_and_exact_prompt(client, monkeypatch):
    original = "他说：“早上的车我自己叫。”\n门还开着。"
    author = (
        "只修当前场景。\n"
        + ("叙事目标仍是克制。😀\n" * 280)
        + "\n示例：“把引号改成直引号。”\n逐字保留「早上的车我自己叫。」"
    )
    assert len(author) < 4000
    calls = []
    monkeypatch.setattr(service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})

    def generate(_source, **kwargs):
        calls.append(kwargs)
        return {"content": original.replace("我自己叫", "你来叫")}

    monkeypatch.setattr(service, "_call_llm_streamed", generate)
    result = client.post(
        "/api/assistant/revise", json={"file_path": "正文.md", "content": original, "instruction": author}
    )
    assert result.status_code == 409, result.text
    assert len(calls) == 1 and author in calls[0]["user_prompt"]
    assert "protected_span_changed" in result.text


@pytest.mark.parametrize(
    "quote",
    [
        "‘I’m told to 把引号改成直引号。’",
        "‘James’s note: 把引号改成直引号。’",
        "'I'm told to 把引号改成直引号。'",
        "‘Don’t 改为第一人称。’",
        "'Don't 改为第一人称。'",
    ],
)
def test_in_word_apostrophes_do_not_end_quoted_material(quote):
    policy = build_author_edit_policy("他问：“灯还亮着？”", instruction=f"不要改引号或人称。示例：{quote}")
    assert not policy.allowed_punctuation_forms
    assert not policy.allow_person_change


@pytest.mark.parametrize("literal", ["I'm still here.", "Don’t leave.", "James’s note."])
def test_in_word_apostrophes_remain_part_of_protected_literal(literal):
    original = f"前文\n{literal}\n后文"
    policy = build_author_edit_policy(original, instruction=f"逐字保留'{literal}'。")
    assert len(policy.protected_spans) == 1
    span = policy.protected_spans[0]
    assert original[span.start : span.end] == literal
