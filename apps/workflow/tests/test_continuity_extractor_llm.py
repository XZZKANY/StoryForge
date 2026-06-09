from __future__ import annotations

import pytest

from storyforge_workflow.nodes import continuity_extractor
from storyforge_workflow.nodes.continuity_extractor import extract_continuity_edges
from storyforge_workflow.prompts.models import CharacterConstraint, NarrativeContext


def test_extract_calls_llm_and_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_generate(prompt, *, temperature=None, model=None):
        captured["prompt"] = prompt
        captured["temperature"] = temperature
        return '[{"edge_kind":"relationship","subject_ref":"character:林岚","predicate":"父","object_ref":"character:林父"}]'

    monkeypatch.setattr(continuity_extractor, "generate_text", fake_generate)

    edges = extract_continuity_edges("林岚是林父的女儿。", chapter_ordinal=3)

    assert len(edges) == 1
    # 用 planning 低温（0.3）以求可解析
    assert captured["temperature"] == 0.3
    # chapter_ordinal 回填默认窗
    assert edges[0]["valid_from_chapter"] == 3


def test_extract_injects_known_entities_into_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, str] = {}

    def fake_generate(prompt, *, temperature=None, model=None):
        seen["prompt"] = prompt
        return "[]"

    monkeypatch.setattr(continuity_extractor, "generate_text", fake_generate)
    ctx = NarrativeContext(characters=(CharacterConstraint(name="林岚", role="主角"),))

    extract_continuity_edges("正文。", context=ctx)

    assert "林岚" in seen["prompt"]


def test_extract_fail_soft_on_llm_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(prompt, *, temperature=None, model=None):
        raise RuntimeError("provider 503")

    monkeypatch.setattr(continuity_extractor, "generate_text", boom)

    assert extract_continuity_edges("非空草稿。") == []


def test_extract_fail_soft_on_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(continuity_extractor, "generate_text", lambda p, **k: "模型开始闲聊，没有 JSON。")

    assert extract_continuity_edges("非空草稿。") == []


def test_extract_empty_draft_skips_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"n": 0}

    def fake_generate(prompt, *, temperature=None, model=None):
        called["n"] += 1
        return "[]"

    monkeypatch.setattr(continuity_extractor, "generate_text", fake_generate)

    assert extract_continuity_edges("") == []
    assert extract_continuity_edges("   ") == []
    assert called["n"] == 0
