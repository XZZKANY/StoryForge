from __future__ import annotations

from storyforge_workflow.orchestrators.book_loop import BookLoopRequest, run_book_loop
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def test_provider_degradation_gate_pauses_after_consecutive_fallbacks() -> None:
    """Phase 9B provider 门禁：连续 fallback 达阈值后自动暂停。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index,
            fallback_metadata={"primary_provider_error": "主 provider 超时"},
        )
    result = run_book_loop(
        BookLoopRequest(
            book_run_id=1,
            book_id=2,
            blueprint_id=3,
            total_chapters=3,
            provider_fallback_pause_threshold=2,
        ),
        run_chapter,
    )

    assert seen == [1, 2]
    assert result.status == "paused_by_provider_degradation"
    assert result.current_chapter_index == 2
    assert result.progress["provider_degradation"]["consecutive_fallbacks"] == 2
