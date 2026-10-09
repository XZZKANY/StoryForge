"""独立保留指令不能借用后续指令的闭引号。"""

import pytest

from app.common.author_edit_policy import author_edit_policy_failures, build_author_edit_policy
from app.domains.assistant import service


@pytest.mark.parametrize("quote", ['"', "'"])
@pytest.mark.parametrize("separator", ["。", "；", ";", "，", ",", "、", "\n", "并", "，并", "，同时请", "。只修旁白；", " 然后请"])
@pytest.mark.parametrize("prefix", ["逐字保留", "原样保持", "保留"])
def test_independent_keep_clauses_do_not_merge(quote, separator, prefix):
    original = "我不走。你先走。"
    instruction = f"{prefix}{quote}我不走{quote}{separator}保留{quote}你先走{quote}逐字不变。"
    policy = build_author_edit_policy(original, instruction=instruction)
    expected = ["你先走"] if prefix == "保留" else ["我不走", "你先走"]
    assert [original[span.start : span.end] for span in policy.protected_spans] == expected
    for literal in expected:
        assert author_edit_policy_failures(original, original.replace(literal, "修改"), policy) == (
            "protected_span_changed",
        )


@pytest.mark.parametrize("quote", ['"', "'"])
@pytest.mark.parametrize("change", ["outside", "first", "second"])
def test_http_independent_keep_clauses_guard_each_literal(client, monkeypatch, quote, change):
    original = "门外有人。\n我不走。\n你先走。\n她没有回头。"
    source, replacement = {
        "outside": ("门外有人。", "有人站在门外。"),
        "first": ("我不走", "我先走"),
        "second": ("你先走", "你别走"),
    }[change]
    candidate = original.replace(source, replacement)
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: calls.append(kw) or {"content": candidate})
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "content": original,
            "instruction": f"逐字保留{quote}我不走{quote}；保留{quote}你先走{quote}逐字不变。只修其他句子。",
        },
    )
    assert len(calls) == 1
    if change == "outside":
        assert response.status_code == 200, response.text
        assert response.json()["after"] == candidate
    else:
        assert response.status_code == 409, response.text
        assert "protected_span_changed" in response.text


@pytest.mark.parametrize("quote", ['"', "'"])
@pytest.mark.parametrize("prefix", ["逐字保留", "原样保持", "保留"])
def test_source_bound_raw_literal_keeps_embedded_directive_opaque(quote, prefix):
    literal = f"他说{quote}我不走{quote}，并保留{quote}一线生机{quote}"
    original = f"前文。\n{literal}\n后文。"
    policy = build_author_edit_policy(original, instruction=f"{prefix}{quote}{literal}{quote}逐字不变。")
    assert [original[span.start : span.end] for span in policy.protected_spans] == [literal]
    candidate = original.replace("并保留", "而放弃")
    assert author_edit_policy_failures(original, candidate, policy) == ("protected_span_changed",)


@pytest.mark.parametrize("quote", ['"', "'"])
@pytest.mark.parametrize("change", ["outside", "inside"])
def test_http_raw_literal_embedded_directive_remains_protected(client, monkeypatch, quote, change):
    literal = f"他说{quote}我不走{quote}，并保留{quote}一线生机{quote}"
    original = f"门外有人。\n{literal}\n她没有回头。"
    candidate = (
        original.replace("并保留", "而放弃")
        if change == "inside"
        else original.replace("门外有人。", "有人站在门外。")
    )
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: calls.append(kw) or {"content": candidate})
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "content": original,
            "instruction": f"逐字保留{quote}{literal}{quote}逐字不变。只修其他句子。",
        },
    )
    assert len(calls) == 1
    if change == "outside":
        assert response.status_code == 200, response.text
        assert response.json()["after"] == candidate
    else:
        assert response.status_code == 409, response.text
        assert "protected_span_changed" in response.text


@pytest.mark.parametrize("quote", ['"', "'"])
def test_unquoted_intervening_command_keeps_its_authority(quote):
    original = "我不走。你先走。"
    instruction = f"逐字保留{quote}我不走{quote}。把引号改成直引号；保留{quote}你先走{quote}逐字不变。"
    policy = build_author_edit_policy(original, instruction=instruction)
    assert [original[span.start : span.end] for span in policy.protected_spans] == ["我不走", "你先走"]
    assert policy.allowed_punctuation_forms == frozenset({"quotes"})


@pytest.mark.parametrize("quote", ['"', "'"])
def test_raw_literal_intervening_command_is_not_authority(quote):
    literal = f"他说{quote}我不走{quote}。把引号改成直引号；保留{quote}一线生机{quote}"
    policy = build_author_edit_policy(literal, instruction=f"逐字保留{quote}{literal}{quote}逐字不变。")
    assert [literal[span.start : span.end] for span in policy.protected_spans] == [literal]
    assert not policy.allowed_punctuation_forms
    assert author_edit_policy_failures(literal, literal.replace("把引号", "把标点"), policy) == (
        "protected_span_changed",
    )


@pytest.mark.parametrize("quote", ['"', "'"])
def test_negated_next_keep_does_not_gain_authority(quote):
    original = "我不走。你先走。"
    instruction = f"逐字保留{quote}我不走{quote}。只修旁白；不要保留{quote}你先走{quote}逐字不变。"
    policy = build_author_edit_policy(original, instruction=instruction)
    assert [original[span.start : span.end] for span in policy.protected_spans] == ["我不走"]


@pytest.mark.parametrize("quote", ['"', "'"])
def test_unadopted_example_intervening_command_is_inert(quote):
    instruction = (
        f"示例：“逐字保留{quote}不存在{quote}。把引号改成直引号；保留{quote}也不存在{quote}逐字不变。”"
        "只修错字。"
    )
    policy = build_author_edit_policy("我不走。你先走。", instruction=instruction)
    assert not policy.protected_spans
    assert not policy.allowed_punctuation_forms
