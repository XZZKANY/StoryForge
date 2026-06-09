from __future__ import annotations

import pytest

from storyforge_workflow.nodes import continuity_extractor
from storyforge_workflow.nodes.continuity_extractor import build_llm_continuity_submitter
from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=92, chapter_index=3, chapter_goal="g")


def _approval_fields(request: NovelLoopRequest, draft: str) -> dict:
    return {
        "previous_chapter_summary": "上一章。",
        "style_drift": "克制。",
        "character_state_changes": {"林岚": "受伤"},
    }


def test_submitter_posts_when_edges_found(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: dict[str, object] = {}

    monkeypatch.setattr(
        continuity_extractor,
        "extract_continuity_edges",
        lambda draft, **kwargs: [
            {"edge_kind": "relationship", "subject_ref": "character:林岚", "predicate": "父", "object_ref": "character:林父"}
        ],
    )

    def fake_post(payload):
        posted["payload"] = payload
        return {"continuity_edge_count": 1, "record_count": 5}

    monkeypatch.setattr(continuity_extractor, "post_chapter_approval", fake_post)

    submit = build_llm_continuity_submitter(_approval_fields)
    result = submit(_request(), "林岚是林父的女儿。", 60)

    assert result["continuity_edge_count"] == 1
    payload = posted["payload"]
    assert payload["chapter_id"] == 92
    assert len(payload["continuity_edges"]) == 1
    # approval_fields 提供的非边字段透传
    assert payload["previous_chapter_summary"] == "上一章。"
    assert payload["style_drift"] == "克制。"


def test_submitter_skips_post_when_no_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"post": 0}

    monkeypatch.setattr(continuity_extractor, "extract_continuity_edges", lambda draft, **kwargs: [])
    monkeypatch.setattr(
        continuity_extractor,
        "post_chapter_approval",
        lambda payload: called.__setitem__("post", called["post"] + 1) or {},
    )

    submit = build_llm_continuity_submitter(_approval_fields)
    result = submit(_request(), "没有可抽取事实的正文。", 60)

    assert result == {}
    assert called["post"] == 0  # 无边不发空批准


def test_submitter_passes_chapter_ordinal_to_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_extract(draft, **kwargs):
        seen["chapter_ordinal"] = kwargs.get("chapter_ordinal")
        return []

    monkeypatch.setattr(continuity_extractor, "extract_continuity_edges", fake_extract)

    submit = build_llm_continuity_submitter(_approval_fields)
    submit(_request(), "正文。", 60)

    assert seen["chapter_ordinal"] == 3
