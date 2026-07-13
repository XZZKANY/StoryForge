from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from agent_transport import agent_result
from fastapi.testclient import TestClient

from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.assistant import service as assistant_service
from app.domains.ide import review_reasoning


def _rich_context_bundle() -> dict[str, object]:
    return {
        "project_root": "D:/books/雾港回声",
        "current_file": "D:/books/雾港回声/正文/第02章.md",
        "summary": {"hasStoryStructure": True, "counts": {"character": 2, "outline": 1, "timeline": 1}},
        "budget": {"file_count": 8, "char_count": 6400, "truncated": True},
        "timeline": [
            {"event_type": "permission_required", "payload": {"secret": "RAW_PERMISSION_PAYLOAD"}},
        ],
        "permission_payload": {"blocked_tool": "file.revise", "reason": "RAW_PERMISSION_PAYLOAD"},
        "ui_debug_json": {"panel_state": "RAW_UI_DEBUG_JSON"},
        "patch_metadata": {"diff": "RAW_PATCH_METADATA"},
        "files": [
            {
                "path": "D:/books/雾港回声/正文/第02章.md",
                "relative_path": "正文/第02章.md",
                "kind": "draft",
                "title": "第02章.md",
                "excerpt": "这是当前文件的旧副本，不应作为上下文文件重复进入。",
            },
            {
                "path": "D:/books/雾港回声/人物/周眠.md",
                "relative_path": "人物/周眠.md",
                "kind": "character",
                "title": "周眠.md",
                "excerpt": "周眠怕水，但必须回到雾港。",
            },
            {
                "path": "D:/books/雾港回声/大纲/第02章节点.md",
                "relative_path": "大纲/第02章节点.md",
                "kind": "outline",
                "title": "第02章节点.md",
                "excerpt": "本章要揭示旧电台。",
            },
            {
                "path": "D:/books/雾港回声/.storyforge/events.json",
                "relative_path": ".storyforge/events.json",
                "kind": "debug",
                "title": "events.json",
                "excerpt": '{"timeline_events":[{"payload":"RAW_TIMELINE_JSON"}]}',
            },
        ],
        "story_memory": {
            "items": [
                {
                    "memory_id": "mem-1",
                    "kind": "character_fact",
                    "entity": "周眠",
                    "fact": "周眠怕水，但为了旧案回到雾港。",
                    "source_chapter_id": 2,
                    "valid_from_chapter": 1,
                }
            ]
        },
        "chapter_context": {
            "chapter_id": 2,
            "chapter_title": "旧电台",
            "summary": "港口旧案浮出水面。",
            "outline": "林岚发现旧电台仍在发送信号。",
            "debug_json": {"raw": "RAW_CHAPTER_DEBUG"},
        },
    }


def _standard_context_bundle() -> dict[str, object]:
    return {
        "project_root": "D:/books/雾港回声",
        "current_file": "D:/books/雾港回声/正文/第02章.md",
        "summary": {"hasStoryStructure": True, "counts": {"character": 1, "outline": 1}},
        "budget": {"file_count": 2, "char_count": 42, "truncated": False},
        "files": [
            {
                "path": "D:/books/雾港回声/人物/周眠.md",
                "relative_path": "人物/周眠.md",
                "kind": "character",
                "title": "周眠.md",
                "excerpt": "周眠怕水，但必须回到雾港。",
            },
            {
                "path": "D:/books/雾港回声/大纲/第02章节点.md",
                "relative_path": "大纲/第02章节点.md",
                "kind": "outline",
                "title": "第02章节点.md",
                "excerpt": "本章要揭示旧电台。",
            },
        ],
    }


def _noisy_standard_context_bundle() -> dict[str, object]:
    bundle = _standard_context_bundle()
    bundle["files"] = [
        {
            "path": "D:/books/雾港回声/正文/第02章.md",
            "relative_path": "正文/第02章.md",
            "kind": "draft",
            "title": "第02章.md",
            "excerpt": "DUPLICATE_SELECTED_CONTEXT_SHOULD_NOT_APPEAR",
        },
        *(bundle["files"] if isinstance(bundle["files"], list) else []),
        {
            "path": "D:/books/雾港回声/.storyforge/events.json",
            "relative_path": ".storyforge/events.json",
            "kind": "debug",
            "title": "events.json",
            "excerpt": '{"timeline_events":[{"payload":"RAW_TIMELINE_JSON"}],"permission":"RAW_PERMISSION_PAYLOAD"}',
        },
    ]
    return bundle


def test_build_llm_context_snapshot_is_stable_and_filters_harness_noise() -> None:
    first = build_llm_context_snapshot(
        run_state=SimpleNamespace(public_id="run-ctx-1", goal="审查第二章", status="running"),
        intent="file.review",
        user_message="请审查当前章节的人物动机",
        file_path="正文/第02章.md",
        content="林岚推开旧电台的门。她想起周眠怕水，却还是回来了。",
        context_bundle=_rich_context_bundle(),
        role_hints=["plot_reviewer", "character_reviewer", "plot_reviewer"],
        role_mentions=["@人物"],
        event_history=[{"event_type": "tool_trace", "payload": {"raw": "RAW_TIMELINE_JSON"}}],
    )
    second = build_llm_context_snapshot(
        run_state=SimpleNamespace(public_id="run-ctx-1", goal="审查第二章", status="running"),
        intent="file.review",
        user_message="请审查当前章节的人物动机",
        file_path="正文/第02章.md",
        content="林岚推开旧电台的门。她想起周眠怕水，却还是回来了。",
        context_bundle=_rich_context_bundle(),
        role_hints=["plot_reviewer", "character_reviewer", "plot_reviewer"],
        role_mentions=["@人物"],
        event_history=[{"event_type": "tool_trace", "payload": {"raw": "RAW_TIMELINE_JSON"}}],
    )

    assert first == second
    assert first["snapshot_id"].startswith("llmctx-")
    assert first["selected_file"]["file_path"] == "正文/第02章.md"
    assert "周眠怕水" in first["selected_file"]["content_excerpt"]
    assert first["role_hints"] == ["plot_reviewer", "character_reviewer"]
    assert [item["relative_path"] for item in first["context_files"]] == ["人物/周眠.md", "大纲/第02章节点.md"]
    assert first["story_memory"]["items"][0]["text"] == "周眠怕水，但为了旧案回到雾港。"
    assert first["chapter_context"]["chapter_title"] == "旧电台"
    assert first["omitted"] == {
        "raw_event_count": 1,
        "unsafe_context_key_count": 4,
        "unsafe_context_file_count": 1,
        "artifact_payload_count": 0,
    }

    encoded = json.dumps(first, ensure_ascii=False, sort_keys=True)
    assert "RAW_PERMISSION_PAYLOAD" not in encoded
    assert "RAW_UI_DEBUG_JSON" not in encoded
    assert "RAW_TIMELINE_JSON" not in encoded
    assert "RAW_PATCH_METADATA" not in encoded
    assert "RAW_CHAPTER_DEBUG" not in encoded


def test_build_llm_context_snapshot_keeps_review_report_as_summary() -> None:
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.revise",
        user_message="按审稿意见修一版",
        file_path="正文/第02章.md",
        content="当前正文",
        context_bundle={"files": []},
        role_hints=["prose_reviewer"],
        review_report={
            "kind": "review_report",
            "file_path": "正文/第02章.md",
            "mode": "heuristic_only",
            "issues": [
                {
                    "id": "plot-1",
                    "category": "plot",
                    "severity": "high",
                    "agent": "plot-agent",
                    "message": "剧情冲突不足。",
                    "evidence": "港口谈判没有代价。",
                    "suggested_action": "补一个明确阻碍。",
                    "raw_payload": {"permission_payload": "SHOULD_NOT_APPEAR"},
                }
            ],
            "suggested_actions": ["先补强章节目标和冲突推进。"],
            "agent_findings": {"plot": {"raw_debug": "SHOULD_NOT_APPEAR"}},
        },
        artifacts=[
            {
                "kind": "proposed_patch",
                "payload": {"before": "OLD_PATCH_TEXT", "after": "NEW_PATCH_TEXT"},
            }
        ],
    )

    assert snapshot["review_report"]["issue_count"] == 1
    assert snapshot["review_report"]["issues"] == [
        {
            "id": "plot-1",
            "category": "plot",
            "severity": "high",
            "agent": "plot-agent",
            "message": "剧情冲突不足。",
            "evidence": "港口谈判没有代价。",
            "suggested_action": "补一个明确阻碍。",
        }
    ]
    assert snapshot["omitted"]["artifact_payload_count"] == 1
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
    assert "SHOULD_NOT_APPEAR" not in encoded
    assert "OLD_PATCH_TEXT" not in encoded
    assert "NEW_PATCH_TEXT" not in encoded


def test_build_llm_context_snapshot_conservatively_degrades_for_missing_or_malformed_context_bundle() -> None:
    missing = build_llm_context_snapshot(
        run_state=None,
        intent="file.review",
        user_message="审一遍",
        file_path="正文/第03章.md",
        content="当前正文",
        context_bundle=None,
    )
    malformed = build_llm_context_snapshot(
        run_state=None,
        intent="file.review",
        user_message="审一遍",
        file_path="正文/第03章.md",
        content="当前正文",
        context_bundle={"files": "not-a-list"},
    )

    assert missing["context_files"] == []
    assert missing["project"] == {}
    assert missing["included_sections"] == ["run", "selected_file"]
    assert malformed["context_files"] == []
    assert malformed["warnings"] == ["context_bundle.files ignored because it was not a list"]


def test_llm_context_snapshot_trace_summary_is_lightweight() -> None:
    snapshot = build_llm_context_snapshot(
        run_state=SimpleNamespace(public_id="run-ctx-2"),
        intent="file.review",
        user_message="审一遍",
        file_path="正文/第02章.md",
        content="当前正文",
        context_bundle=_rich_context_bundle(),
        review_report={"kind": "review_report", "issues": []},
    )

    assert llm_context_snapshot_trace_summary(snapshot) == {
        "snapshot_id": snapshot["snapshot_id"],
        "section_count": 7,
        "context_file_count": 2,
        "story_memory_count": 1,
        "has_chapter_context": True,
        "has_review_report": True,
        "warning_count": 0,
    }


def test_llm_context_snapshot_to_prompt_context_bundle_is_sanitized() -> None:
    snapshot = build_llm_context_snapshot(
        run_state=SimpleNamespace(public_id="run-ctx-prompt"),
        intent="file.review",
        user_message="审一遍",
        file_path="正文/第02章.md",
        content="当前正文",
        context_bundle=_rich_context_bundle(),
    )

    prompt_bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)

    assert prompt_bundle["current_file"] == "D:/books/雾港回声/正文/第02章.md"
    assert [item["relative_path"] for item in prompt_bundle["files"]] == [
        "人物/周眠.md",
        "大纲/第02章节点.md",
        "Story Memory",
        "Chapter Context",
    ]
    encoded = json.dumps(prompt_bundle, ensure_ascii=False, sort_keys=True)
    assert "周眠怕水" in encoded
    assert "旧电台" in encoded
    assert "RAW_PERMISSION_PAYLOAD" not in encoded
    assert "RAW_UI_DEBUG_JSON" not in encoded
    assert "RAW_TIMELINE_JSON" not in encoded
    assert "RAW_PATCH_METADATA" not in encoded


def test_file_review_runtime_records_llm_context_snapshot_summary(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    context_bundle = _rich_context_bundle()
    message = agent_result(
        client,
        "session-llm-context-review",
        user_message="审查当前章节的人物动机",
        intent="file.review",
        args={
            "file_path": "正文/第02章.md",
            "content": "林岚推开旧电台的门。她想起周眠怕水，却还是回来了。",
            "context_bundle": context_bundle,
            "agent_role_hints": ["character_reviewer"],
        },
    )

    context_trace = next(trace for trace in message["tool_trace"] if trace["tool_name"] == "context.load")
    llm_context = context_trace["output_summary"]["llm_context"]
    assert llm_context["snapshot_id"].startswith("llmctx-")
    assert llm_context["context_file_count"] == 2
    assert llm_context["story_memory_count"] == 1
    assert llm_context["has_chapter_context"] is True
    assert llm_context["warning_count"] == 0

    encoded = json.dumps(message, ensure_ascii=False, sort_keys=True)
    assert "RAW_PERMISSION_PAYLOAD" not in encoded
    assert "RAW_UI_DEBUG_JSON" not in encoded
    assert "RAW_TIMELINE_JSON" not in encoded
    assert "RAW_PATCH_METADATA" not in encoded


def test_file_review_llm_prompt_uses_sanitized_snapshot_context(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        review_reasoning,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_MODEL": "storyforge-reviewer",
            "STORYFORGE_LLM_BASE_URL": "https://example.test/v1",
            "STORYFORGE_LLM_API_KEY": "test-key",
        },
    )
    captured_prompts: list[str] = []

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        captured_prompts.append(user_prompt)
        return {"content": "[]", "completion_tokens": 1, "latency_ms": 1}

    monkeypatch.setattr(review_reasoning, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-llm-context-review-prompt",
        user_message="审查当前章节的人物动机",
        intent="file.review",
        args={
            "file_path": "正文/第02章.md",
            "content": "林岚推开旧电台的门。她想起周眠怕水，却还是回来了。",
            "context_bundle": _rich_context_bundle(),
            "agent_role_hints": ["character_reviewer"],
        },
    )

    assert message["agent_result"]["review_report"]["mode"] == "llm"
    assert len(captured_prompts) == 3
    encoded = "\n".join(captured_prompts)
    assert "人物/周眠.md" in encoded
    assert "Story Memory" in encoded
    assert "Chapter Context" in encoded
    assert "RAW_PERMISSION_PAYLOAD" not in encoded
    assert "RAW_UI_DEBUG_JSON" not in encoded
    assert "RAW_TIMELINE_JSON" not in encoded
    assert "RAW_PATCH_METADATA" not in encoded


def test_file_revise_runtime_links_revise_trace_to_llm_context_snapshot(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    captured: dict[str, str] = {}

    def fake_call_llm(source, *, system_prompt, user_prompt):  # noqa: ANN001 - test stub
        captured["user_prompt"] = user_prompt
        return {
            "content": "修订后正文",
            "completion_tokens": 8,
            "latency_ms": 10,
        }

    monkeypatch.setattr(assistant_service, "_call_llm", fake_call_llm)

    message = agent_result(
        client,
        "session-llm-context-revise",
        run_id="run-llm-context-revise",
        user_message="按人物动机问题修一版",
        intent="file.revise",
        args={
            "file_path": "正文/第02章.md",
            "content": "当前正文",
            "instruction": "补清周眠为什么回到雾港",
            "context_bundle": _noisy_standard_context_bundle(),
            "agent_role_hints": ["character_reviewer"],
        },
    )

    assert message["type"] == "agent_result", message
    context_trace = next(trace for trace in message["tool_trace"] if trace["tool_name"] == "context.load")
    revise_trace = next(trace for trace in message["tool_trace"] if trace["tool_name"] == "file.revise")
    assert revise_trace["input_summary"]["llm_context_snapshot_id"] == context_trace["output_summary"]["llm_context"]["snapshot_id"]
    assert message["proposed_patch"]["requires_confirmation"] is True
    assert "人物/周眠.md" in captured["user_prompt"]
    assert "DUPLICATE_SELECTED_CONTEXT_SHOULD_NOT_APPEAR" not in captured["user_prompt"]
    assert "RAW_TIMELINE_JSON" not in captured["user_prompt"]
    assert "RAW_PERMISSION_PAYLOAD" not in captured["user_prompt"]
