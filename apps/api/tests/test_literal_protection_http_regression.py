import pytest

from app.domains.assistant import service


def test_revise_http_rejects_modification_of_explicitly_preserved_inches(client, monkeypatch):
    original = '他指着纸页说，屏幕显示 6"。\n门口传来一阵脚步声。'
    candidate = original.replace("6", "7")
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: {"content": candidate})
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "正文.md",
            "content": original,
            "instruction": '保留“屏幕显示 6"。”逐字不变。只修其他句子。',
        },
    )
    assert response.status_code == 409, response.text
    assert "protected_span_changed" in response.text


@pytest.mark.parametrize("literal", ['屏幕显示 6"。', "他读到：'twas the night。", "路径末尾是 C:\\"])
@pytest.mark.parametrize("change_protected", [False, True])
def test_revise_http_raw_literal_rejects_only_the_protected_change(client, monkeypatch, literal, change_protected):
    original = f"门外有人。\n{literal}\n她没有回头。"
    candidate = (
        original.replace(literal, "被修改的句子。")
        if change_protected
        else original.replace("门外有人。", "有人站在门外。")
    )
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: {"content": candidate})
    response = client.post(
        "/api/assistant/revise",
        json={"file_path": "正文.md", "content": original, "instruction": f"保留“{literal}”逐字不变。只修其他句子。"},
    )
    if change_protected:
        assert response.status_code == 409, response.text
        assert "protected_span_changed" in response.text
    else:
        assert response.status_code == 200, response.text
        assert response.json()["after"] == candidate


@pytest.mark.parametrize("instruction", ["保留“原文逐字不变。", "请执行“保留「原文」逐字不变。"])
def test_unresolved_literal_http_fails_explicitly_before_generation(client, monkeypatch, instruction):
    calls = []
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(service, "resolved_llm_env", lambda: {})
    monkeypatch.setattr(service, "_call_llm_streamed", lambda *a, **kw: calls.append(kw) or {"content": "改写。"})
    response = client.post(
        "/api/assistant/revise", json={"file_path": "正文.md", "content": "原文", "instruction": instruction}
    )
    # Reuse the established AuthorEditPolicyError HTTP mapping, not a new API contract.
    assert response.status_code == 502, response.text
    assert "重新指定需要逐字保留的片段" in response.json()["detail"]
    assert calls == []
