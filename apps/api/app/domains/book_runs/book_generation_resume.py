"""Resume orchestration for an existing real-LLM BookRun."""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping

from sqlalchemy.orm import Session

from app.common.metrics import observe_book_generation_chapter
from app.domains.book_runs.book_generation_contracts import (
    BookGenerationResult,
    assert_no_missing_chapters,
    count_approved_chapters,
)
from app.domains.book_runs.book_generation_judge import judge_and_repair_loop
from app.domains.book_runs.book_generation_llm import required_env, total_cost_estimate
from app.domains.book_runs.book_generation_memory import (
    extract_memory_atoms_for_chapter,
    memory_recall_chars_for_chapter,
)
from app.domains.book_runs.book_generation_preflight import assert_preflight
from app.domains.book_runs.book_generation_progress import pause_by_budget, pause_by_failure, pause_by_interrupt
from app.domains.book_runs.book_generation_records import (
    finalize_scene_decision,
    persist_draft_scene,
    record_model_run,
    record_scene_packet,
)
from app.domains.book_runs.book_generation_serial_metrics import serial_integration_metrics
from app.domains.book_runs.book_generation_setup import chapter_for_generation, reconstruct_completed_chapters
from app.domains.book_runs.errors import BookGenerationError
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.schemas import BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown

GenerateChapter = Callable[..., dict[str, object]]


def resume_book_generation(
    session: Session,
    *,
    book_run_id: int,
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    max_chapter_count: int = 10,
    env: Mapping[str, str | None] | None = None,
    generate_chapter: GenerateChapter,
) -> BookGenerationResult:
    """从已保留的真实 LLM 生成的 SQLite 继续补完剩余章节。"""

    source = os.environ if env is None else env
    assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    started_at = time.monotonic()
    book_run = session.get(BookRun, book_run_id)
    if book_run is None:
        raise BookGenerationError(f"BookRun {book_run_id} 不存在，无法断点续跑。")
    if book_run.status == "completed":
        markdown_artifact = export_book_run_markdown(session, book_run.id)
        audit_artifact = export_book_run_audit_report(session, book_run.id)
        return BookGenerationResult(
            book_run=book_run,
            markdown_artifact=markdown_artifact,
            audit_artifact=audit_artifact,
            chapter_count=chapter_count,
            approved_chapter_count=count_approved_chapters(
                reconstruct_completed_chapters(session, book_run.id)
            ),
        )
    if book_run.total_chapters != chapter_count:
        book_run.total_chapters = chapter_count
        book_run.chapter_budget = chapter_count
        session.commit()
        session.refresh(book_run)

    completed_chapters = reconstruct_completed_chapters(session, book_run.id)
    completed_ordinals = {
        int(item["chapter_index"])
        for item in completed_chapters
        if isinstance(item.get("chapter_index"), int)
    }
    tokens_used = sum(int(item.get("token_usage") or 0) for item in completed_chapters)

    for chapter_index in range(1, chapter_count + 1):
        if chapter_index in completed_ordinals:
            continue
        chapter_started_at = time.monotonic()
        chapter = chapter_for_generation(session, book_run.book_id, chapter_index)
        memory_recall_chars = memory_recall_chars_for_chapter(session, book_run.book_id, chapter.ordinal)
        # 整章体纳入 try 并补 except BookGenerationError（镜像初始 run_book_generation）：
        # generate_chapter / judge_and_repair_loop 的 LLM 调用抖动都抛 BookGenerationError，
        # 此前 resume 只捕 KeyboardInterrupt/SystemExit → 该异常裸冒泡到后台 wrapper 被吞，
        # BookRun 永远卡 running（僵尸，D1-001）。现在与初始循环一致：落失败证据 + 翻 failed + 重抛。
        try:
            generated = generate_chapter(session, source, chapter_index, chapter, book_run_id=book_run.id)
            tokens_used += int(generated["token_usage"])
            scene = persist_draft_scene(session, chapter, str(generated["content"]))
            model_run = record_model_run(session, book_run, scene, source, generated)
            scene_packet = record_scene_packet(
                session,
                book_run,
                scene,
                story_state_changes=list(generated.get("story_state_changes") or []),
                story_state_changes_source=str(generated.get("story_state_changes_source") or ""),
            )
            outcome = judge_and_repair_loop(session, source, book_run, scene, scene_packet)
            observe_book_generation_chapter(
                judge_call_count=int(outcome.get("judge_call_count") or 0),
                repair_patch_count=len(outcome.get("repair_patch_ids") or []),
                cost_cny_estimated=float(generated.get("cost_cny_estimated") or 0.0),
            )
            approved = finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
            memory_atom_ids = (
                extract_memory_atoms_for_chapter(
                    session,
                    book_id=book_run.book_id,
                    chapter_id=chapter.id,
                    chapter_ordinal=chapter.ordinal,
                    approved_scene_id=int(scene.id),
                    content=scene.content or str(generated["content"]),
                )
                if approved
                else []
            )
        except BookGenerationError as exc:
            pause_by_failure(session, book_run.id, chapter_index, completed_chapters, tokens_used, str(exc))
            raise BookGenerationError(
                f"真实 LLM 断点续跑在第 {chapter_index} 章失败，已保住前 {len(completed_chapters)} 章证据：{exc}"
            ) from exc
        except (KeyboardInterrupt, SystemExit):
            pause_by_interrupt(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": outcome["judge_report_id"],
                "repair_patch_id": outcome["repair_patch_id"],
                "repair_patch_ids": outcome["repair_patch_ids"],
                "repair_rounds": outcome["repair_rounds"],
                "judge_call_count": int(outcome.get("judge_call_count") or 0),
                "approved_scene_id": scene.id,
                "scene_status": scene.status,
                "approved": approved,
                "token_usage": generated["token_usage"],
                "prompt_tokens": generated["prompt_tokens"],
                "completion_tokens": generated["completion_tokens"],
                "generation_latency_ms": generated["latency_ms"],
                "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                "chapter_elapsed_time_sec": max(0, int(time.monotonic() - chapter_started_at)),
                "cost_estimate": generated["cost_cny_estimated"],
                "cost_breakdown": generated["cost_breakdown"],
                "quality_score": outcome["quality_score"],
                "quality_issues": outcome["quality_issues"],
                "story_state_commit": outcome.get("story_state_commit"),
                "story_state_changes_source": generated.get("story_state_changes_source"),
                "story_state_tool_call_count": generated.get("story_state_tool_call_count", 0),
                "memory_atom_ids": memory_atom_ids,
                "memory_recall_chars": memory_recall_chars,
            }
        )
        completed_ordinals.add(chapter_index)
        if tokens_used > token_budget:
            pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 断点续跑触发 token 预算暂停，不能标记为 completed。")

    completed_chapters.sort(key=lambda item: int(item.get("chapter_index") or 0))
    assert_no_missing_chapters(session, book_run.id, chapter_count, completed_chapters, tokens_used)
    book_run = apply_book_run_progress(
        session,
        book_run.id,
        BookRunProgressUpdate(
            status="completed",
            current_chapter_index=chapter_count,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {
                    "tokens_used": tokens_used,
                    "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                    "estimated_cost": total_cost_estimate(completed_chapters),
                },
                "integration_metrics": serial_integration_metrics(session, book_run, completed_chapters),
                "real_llm_smoke": {
                    "provider_name": required_env(source, "STORYFORGE_LLM_PROVIDER"),
                    "model_name": required_env(source, "STORYFORGE_LLM_MODEL"),
                    "chapter_count": chapter_count,
                    "resume": True,
                },
            },
        ),
    )
    markdown_artifact = export_book_run_markdown(session, book_run.id)
    audit_artifact = export_book_run_audit_report(session, book_run.id)
    return BookGenerationResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
        approved_chapter_count=count_approved_chapters(completed_chapters),
    )
