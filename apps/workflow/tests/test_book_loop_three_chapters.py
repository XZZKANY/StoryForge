from __future__ import annotations

from storyforge_workflow.orchestrators.book_loop import BookLoopRequest, run_book_loop
from storyforge_workflow.orchestrators.novel_loop import NovelLoopResult


def test_book_loop_runs_three_chapters_to_completed() -> None:
    """BookLoop 应按章节顺序驱动三章 NovelLoop 并完成。"""

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

    result = run_book_loop(BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3), run_chapter)

    assert result.status == "completed"
    assert result.current_chapter_index == 3
    assert seen == [1, 2, 3]
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2, 3]


def test_book_loop_stops_when_chapter_awaits_review() -> None:
    """任一章节需要人工审查时，BookLoop 不应继续后续章节。"""

    seen: list[int] = []

    def run_chapter(chapter_index: int) -> NovelLoopResult:
        seen.append(chapter_index)
        return NovelLoopResult(
            status="awaiting_review" if chapter_index == 2 else "approved",
            final_draft=f"第 {chapter_index} 章正文。",
            source_model_run_id=chapter_index,
            judge_report_id=chapter_index,
            repair_patch_id=None,
            approved_scene_id=chapter_index if chapter_index == 1 else None,
        )

    result = run_book_loop(BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3), run_chapter)

    assert result.status == "awaiting_review"
    assert result.current_chapter_index == 2
    assert seen == [1, 2]
    assert result.progress["blocked_chapter"]["chapter_index"] == 2


def test_book_loop_resume_skips_completed_checkpoint_chapters() -> None:
    """恢复运行时应从 checkpoint 下一章继续，不重复执行已批准章节。"""

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
            token_usage=120,
            cost_estimate=0.02,
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
    assert len(result.progress["checkpoint"]) == 3


def test_book_loop_pauses_when_token_budget_is_reached() -> None:
    """Token 预算触顶后 BookLoop 必须硬暂停，不能继续下一章。"""

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
            token_usage=80,
            cost_estimate=0.03,
        )

    result = run_book_loop(
        BookLoopRequest(book_run_id=1, book_id=2, blueprint_id=3, total_chapters=3, token_budget=100),
        run_chapter,
    )

    assert seen == [1, 2]
    assert result.status == "paused_by_budget"
    assert result.current_chapter_index == 2
    assert result.progress["budget"]["tokens_used"] == 160
    assert result.progress["pause_reason"] == "token_budget_exceeded"


def test_book_loop_pauses_after_consecutive_fallbacks() -> None:
    """连续 fallback 达到阈值时应暂停，避免整本书静默跑在备用模型上。"""

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
