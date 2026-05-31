from __future__ import annotations

from copy import deepcopy

from storyforge_workflow.skills.audit import derive_skill_chain_summary

FORBIDDEN_STATUS_VALUES = {"repair_required", "repair_limit_exceeded", "provider_failed", "budget_exceeded"}


def test_summary_derives_approved_chapter_skill_chain_without_mutating_progress() -> None:
    """已批准章节应派生 generate、judge、approve、memory_extract 链路且不修改输入。"""

    progress = {
        "completed_chapters": [
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 11,
                "judge_report_id": 12,
                "repair_patch_id": None,
                "approved_scene_id": 13,
                "memory_atom_ids": [],
                "token_usage": 120,
                "elapsed_time_sec": 3,
                "cost_estimate": 0.02,
                "fallback_metadata": None,
            }
        ],
        "checkpoint": [{"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}],
        "budget": {"tokens_used": 120, "elapsed_time_sec": 3, "estimated_cost": 0.02},
    }
    before = deepcopy(progress)

    summary = derive_skill_chain_summary(progress)

    assert progress == before
    assert summary["skill_chain_version"] == "bookrun-default-v1"
    assert summary["book_status_projection"] == {"status": "completed", "pause_reason": None}
    assert summary["book_level_skills"] == []
    assert summary["chapters"] == [
        {
            "chapter_index": 1,
            "status": "approved",
            "skills": [
                {"skill_name": "generate", "status": "generated", "model_run_id": 11},
                {"skill_name": "judge", "status": "pass", "judge_report_id": 12},
                {"skill_name": "approve", "status": "approved", "approved_scene_id": 13, "source_model_run_id": 11, "judge_report_id": 12},
                {"skill_name": "memory_extract", "status": "memory_extract_skipped", "memory_atom_ids": []},
            ],
        }
    ]


def test_summary_derives_memory_updated_and_repair_reference_for_approved_chapter() -> None:
    """存在记忆和修复补丁引用时，摘要应保留因果链引用。"""

    summary = derive_skill_chain_summary(
        {
            "completed_chapters": [
                {
                    "chapter_index": 2,
                    "status": "approved",
                    "model_run_id": 21,
                    "judge_report_id": 22,
                    "repair_patch_id": 23,
                    "approved_scene_id": 24,
                    "memory_atom_ids": ["memory:linlan"],
                }
            ],
            "checkpoint": [],
            "budget": {},
        }
    )

    skills = summary["chapters"][0]["skills"]
    assert {skill["skill_name"] for skill in skills} == {"generate", "judge", "repair", "approve", "memory_extract"}
    assert {"skill_name": "repair", "status": "repaired", "repair_patch_id": 23, "source_judge_report_id": 22} in skills
    assert skills[-1] == {"skill_name": "memory_extract", "status": "memory_updated", "memory_atom_ids": ["memory:linlan"]}


def test_summary_maps_blocked_chapter_to_awaiting_review_only() -> None:
    """受阻章节只能映射为 awaiting_review，不能制造额外终态。"""

    progress = {
        "completed_chapters": [],
        "checkpoint": [],
        "blocked_chapter": {
            "chapter_index": 3,
            "status": "awaiting_review",
            "model_run_id": 31,
            "judge_report_id": 32,
            "repair_patch_id": 33,
            "approved_scene_id": None,
        },
        "budget": {"tokens_used": 90, "elapsed_time_sec": 2, "estimated_cost": 0.01},
    }

    summary = derive_skill_chain_summary(progress)

    blocked = summary["chapters"][0]
    assert blocked["status"] == "awaiting_review"
    assert {"skill_name": "repair", "status": "repaired", "repair_patch_id": 33, "source_judge_report_id": 32} in blocked["skills"]
    assert summary["book_status_projection"] == {"status": "awaiting_review", "pause_reason": None}
    _assert_no_forbidden_status(summary)


def test_summary_projects_budget_pause_at_book_level() -> None:
    """预算暂停只能出现在 book_status_projection 中，并保留 pause_reason。"""

    summary = derive_skill_chain_summary(
        {
            "completed_chapters": [
                {"chapter_index": 1, "status": "approved", "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
            ],
            "checkpoint": [],
            "budget": {"tokens_used": 160},
            "pause_reason": "token_budget_exceeded",
        }
    )

    assert summary["book_status_projection"] == {"status": "paused_by_budget", "pause_reason": "token_budget_exceeded"}
    _assert_no_forbidden_status(summary)


def test_summary_projects_provider_degradation_at_book_level() -> None:
    """provider 连续降级只能表达为 BookLoop 级暂停投影。"""

    summary = derive_skill_chain_summary(
        {
            "completed_chapters": [
                {
                    "chapter_index": 1,
                    "status": "approved",
                    "model_run_id": 11,
                    "judge_report_id": 12,
                    "approved_scene_id": 13,
                    "fallback_metadata": {"primary_provider_error": "主 provider 超时"},
                }
            ],
            "checkpoint": [],
            "budget": {},
            "provider_degradation": {"consecutive_fallbacks": 2, "latest_fallback": {"primary_provider_error": "主 provider 超时"}},
        }
    )

    assert summary["book_status_projection"] == {"status": "paused_by_provider_degradation", "pause_reason": None}
    assert summary["provider_degradation"] == {"consecutive_fallbacks": 2, "latest_fallback": {"primary_provider_error": "主 provider 超时"}}
    _assert_no_forbidden_status(summary)


def test_summary_includes_export_when_artifact_ids_are_present() -> None:
    """进度中已有导出制品引用时，BookRun 级 export 技能应进入摘要。"""

    summary = derive_skill_chain_summary(
        {
            "completed_chapters": [],
            "checkpoint": [],
            "budget": {},
            "artifact_ids": [101, 102, 103],
        }
    )

    assert summary["book_level_skills"] == [{"skill_name": "export", "status": "exported", "artifact_ids": [101, 102, 103]}]


def _assert_no_forbidden_status(value: object) -> None:
    if isinstance(value, dict):
        for item in value.values():
            _assert_no_forbidden_status(item)
        return
    if isinstance(value, list | tuple):
        for item in value:
            _assert_no_forbidden_status(item)
        return
    if isinstance(value, str):
        assert value not in FORBIDDEN_STATUS_VALUES
