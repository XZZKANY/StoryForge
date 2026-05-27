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
