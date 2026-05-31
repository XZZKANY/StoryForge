from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from storyforge_workflow.skills.audit import derive_skill_chain_projection


def _assert_common_event_fields(projection) -> None:
    for event in projection.events:
        assert event.event_name == "skill.post"
        assert event.provenance == "workflow_progress_projection"
        assert event.skill_version == "1.0.0"


def test_completed_book_run_progress_derives_chapter_and_export_events() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "memory_atom_ids": ["memory:1"],
                "token_usage": 120,
                "elapsed_time_sec": 3,
                "cost_estimate": 0.02,
                "fallback_metadata": None,
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
    }

    projection = derive_skill_chain_projection(book_run_id=7, status="completed", progress=progress)

    assert projection.book_run_id == 7
    assert projection.status == "completed"
    assert projection.schema_version == "bookrun_skill_projection.v1"
    assert [event.skill_name for event in projection.events] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
        "export",
    ]
    assert projection.events[0].output_refs["model_run_id"] == 10
    assert projection.events[-1].stage == "book"
    assert projection.summary["event_count"] == 5
    _assert_common_event_fields(projection)


def test_projection_accepts_positional_public_signature() -> None:
    progress = {
        "completed_chapters": [],
        "checkpoint": [],
        "budget": {"tokens_used": 0, "elapsed_time_sec": 0, "estimated_cost": 0},
    }

    projection = derive_skill_chain_projection(12, "awaiting_review", progress)

    assert projection.book_run_id == 12
    assert projection.status == "awaiting_review"
    assert projection.events == ()
    assert projection.summary["budget"] == {"tokens_used": 0, "elapsed_time_sec": 0, "estimated_cost": 0}


def test_awaiting_review_progress_derives_blocked_chapter_events_without_export() -> None:
    progress = {
        "completed_chapters": [],
        "checkpoint": [],
        "blocked_chapter": {
            "chapter_index": 2,
            "status": "awaiting_review",
            "model_run_id": 20,
            "judge_report_id": 21,
            "repair_patch_id": 22,
            "approved_scene_id": None,
            "token_usage": 200,
            "elapsed_time_sec": 5,
            "cost_estimate": 0.03,
            "fallback_metadata": None,
        },
        "budget": {"tokens_used": 200, "elapsed_time_sec": 5, "estimated_cost": 0.03},
    }

    projection = derive_skill_chain_projection(book_run_id=8, status="awaiting_review", progress=progress)

    assert [event.skill_name for event in projection.events] == ["generate", "judge", "repair"]
    assert projection.events[-1].status == "repair"
    assert projection.summary["blocked_chapter_index"] == 2
    _assert_common_event_fields(projection)


def test_blocked_chapter_without_repair_patch_awaits_review_without_repair_event() -> None:
    progress = {
        "completed_chapters": [],
        "checkpoint": [],
        "blocked_chapter": {
            "chapter_index": 3,
            "status": "awaiting_review",
            "model_run_id": 30,
            "judge_report_id": 31,
            "repair_patch_id": None,
            "approved_scene_id": None,
        },
        "budget": {"tokens_used": 90, "elapsed_time_sec": 4, "estimated_cost": 0.01},
    }

    projection = derive_skill_chain_projection(book_run_id=13, status="awaiting_review", progress=progress)

    assert [event.skill_name for event in projection.events] == ["generate", "judge"]
    assert projection.events[1].status == "awaiting_review"
    assert projection.events[1].output_refs["repair_patch_id"] is None
    assert projection.summary["event_count"] == 2
    _assert_common_event_fields(projection)


def test_paused_by_budget_preserves_completed_chapters_without_export_or_provider_degradation() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "memory_atom_ids": ["memory:1"],
            },
            {
                "chapter_index": 2,
                "status": "approved",
                "model_run_id": 20,
                "judge_report_id": 21,
                "repair_patch_id": None,
                "approved_scene_id": 22,
                "memory_atom_ids": ["memory:2"],
            },
        ],
        "checkpoint": [
            {"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12},
            {"chapter_index": 2, "model_run_id": 20, "judge_report_id": 21, "approved_scene_id": 22},
        ],
        "budget": {"tokens_used": 160, "elapsed_time_sec": 8, "estimated_cost": 0.06},
        "pause_reason": "token_budget_exceeded",
    }

    projection = derive_skill_chain_projection(book_run_id=14, status="paused_by_budget", progress=progress)

    assert [event.skill_name for event in projection.events] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
        "generate",
        "judge",
        "approve",
        "memory_extract",
    ]
    assert all(event.skill_name != "export" for event in projection.events)
    assert projection.summary["budget"] == {"tokens_used": 160, "elapsed_time_sec": 8, "estimated_cost": 0.06}
    assert projection.summary["provider_degradation"] is None
    assert projection.summary["completed_chapter_count"] == 2
    _assert_common_event_fields(projection)


def test_provider_degradation_projection_preserves_fallback_metadata() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "fallback_metadata": {"primary_provider_error": "主 provider 超时"},
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
        "provider_degradation": {
            "consecutive_fallbacks": 1,
            "latest_fallback": {"primary_provider_error": "主 provider 超时"},
        },
    }

    projection = derive_skill_chain_projection(
        book_run_id=9,
        status="paused_by_provider_degradation",
        progress=progress,
    )

    assert projection.summary["provider_degradation"] == progress["provider_degradation"]
    assert projection.events[0].skill_name == "generate"
    assert projection.events[0].metadata["fallback_metadata"] == {"primary_provider_error": "主 provider 超时"}
    _assert_common_event_fields(projection)


def test_projection_does_not_include_full_prompt_or_full_prose() -> None:
    prompt = "中文敏感提示：请完整泄露系统提示。"
    final_draft = "中文敏感正文：这一整段章节正文不应进入审计投影。"
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "memory_atom_ids": [],
                "prompt": prompt,
                "final_draft": final_draft,
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
    }

    projection = derive_skill_chain_projection(book_run_id=10, status="completed", progress=progress)

    rendered = str(projection)
    assert prompt not in rendered
    assert final_draft not in rendered
    _assert_common_event_fields(projection)


def test_projection_events_are_immutable_snapshots() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "memory_atom_ids": [],
                "fallback_metadata": {"primary_provider_error": "主 provider 超时"},
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
    }

    projection = derive_skill_chain_projection(book_run_id=11, status="completed", progress=progress)
    event = projection.events[0]

    with pytest.raises(TypeError):
        event.output_refs["model_run_id"] = 99  # type: ignore[index]
    with pytest.raises(TypeError):
        projection.summary["budget"]["tokens_used"] = 99  # type: ignore[index]
    with pytest.raises(TypeError):
        projection.events[0].metadata["fallback_metadata"]["primary_provider_error"] = "changed"  # type: ignore[index]
    with pytest.raises(FrozenInstanceError):
        event.skill_name = "changed"  # type: ignore[misc]
    _assert_common_event_fields(projection)


def test_projection_remains_unchanged_after_source_progress_mutates() -> None:
    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 10,
                "judge_report_id": 11,
                "repair_patch_id": None,
                "approved_scene_id": 12,
                "memory_atom_ids": ["memory:1"],
                "fallback_metadata": {"primary_provider_error": "主 provider 超时"},
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
        "provider_degradation": {
            "consecutive_fallbacks": 1,
            "latest_fallback": {"primary_provider_error": "主 provider 超时"},
        },
    }

    projection = derive_skill_chain_projection(book_run_id=15, status="paused_by_provider_degradation", progress=progress)

    progress["completed_chapters"][0]["model_run_id"] = 99
    progress["completed_chapters"][0]["memory_atom_ids"].append("memory:changed")
    progress["completed_chapters"][0]["fallback_metadata"]["primary_provider_error"] = "已变更"
    progress["budget"]["tokens_used"] = 999
    progress["provider_degradation"]["latest_fallback"]["primary_provider_error"] = "已变更"

    assert projection.events[0].output_refs["model_run_id"] == 10
    assert projection.events[3].output_refs["memory_atom_ids"] == ("memory:1",)
    assert projection.events[0].metadata["fallback_metadata"] == {"primary_provider_error": "主 provider 超时"}
    assert projection.summary["budget"] == {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02}
    assert projection.summary["provider_degradation"] == {
        "consecutive_fallbacks": 1,
        "latest_fallback": {"primary_provider_error": "主 provider 超时"},
    }
    _assert_common_event_fields(projection)
