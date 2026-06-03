from __future__ import annotations

from storyforge_workflow.orchestrators.book_loop import BookLoopRequest, run_book_loop
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def test_book_loop_resume_gate_skips_completed_checkpoint_chapters() -> None:
    """Phase 9B resume 门禁：已批准章节不得重复执行。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index * 10,
            judge_report_id=chapter_index * 10 + 1,
            repair_patch_id=None,
            approved_scene_id=chapter_index * 10 + 2,
        )
    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            start_chapter_index=3,
            existing_checkpoint=[
                {"chapter_index": 1, "model_run_id": 10, "judge_report_id": 11, "approved_scene_id": 12},
                {"chapter_index": 2, "model_run_id": 20, "judge_report_id": 21, "approved_scene_id": 22},
            ],
        ),
        run_chapter,
    )

    assert seen == [3]
    assert result.status == "completed"
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2, 3]


def test_book_loop_resume_accumulates_checkpoint_budget_and_keeps_skill_runs() -> None:
    """恢复时历史预算必须继续累计，输出 checkpoint 也要保留审计摘要供下次恢复。"""

    seen: list[int] = []
    historical_skill_runs = [
        {
            "skill_name": "generate",
            "skill_version": "1.0.0",
            "status": "generated",
            "output_refs": {"model_run_id": 10},
            "budget": {"token_usage": 90},
        }
    ]

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index * 10,
            judge_report_id=chapter_index * 10 + 1,
            repair_patch_id=None,
            approved_scene_id=chapter_index * 10 + 2,
            token_usage=40,
            elapsed_time_sec=3,
            cost_estimate=0.02,
            skill_runs=(
                {
                    "skill_name": "generate",
                    "skill_version": "1.0.0",
                    "status": "generated",
                    "output_refs": {"model_run_id": chapter_index * 10},
                    "budget": {"token_usage": 40},
                },
            ),
        )

    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=2,
            start_chapter_index=2,
            existing_checkpoint=[
                {
                    "chapter_index": 1,
                    "status": "approved",
                    "model_run_id": 10,
                    "judge_report_id": 11,
                    "approved_scene_id": 12,
                    "token_usage": 90,
                    "elapsed_time_sec": 7,
                    "cost_estimate": 0.05,
                    "skill_runs": historical_skill_runs,
                }
            ],
            token_budget=100,
        ),
        run_chapter,
    )

    assert seen == [2]
    assert result.status == "paused_by_budget"
    assert result.progress["budget"] == {"tokens_used": 130, "elapsed_time_sec": 10, "estimated_cost": 0.07}
    assert result.progress["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert result.progress["checkpoint"][0]["skill_runs"] == historical_skill_runs
    assert result.progress["checkpoint"][1]["token_usage"] == 40
    assert result.progress["checkpoint"][1]["skill_runs"][0]["skill_name"] == "generate"
