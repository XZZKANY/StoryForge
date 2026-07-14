from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from typing import TextIO

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.common.metrics import observe_book_generation_chapter
from app.domains.blueprints.models import BookBlueprint  # noqa: F401  facade re-export
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
from app.domains.book_runs import book_generation_draft as generation_draft
from app.domains.book_runs import book_generation_judge as generation_judge
from app.domains.book_runs import book_generation_llm as generation_llm
from app.domains.book_runs import book_generation_metrics as generation_metrics
from app.domains.book_runs import book_generation_records as generation_records
from app.domains.book_runs import book_generation_setup as generation_setup
from app.domains.book_runs.book_generation_changes import StoryStateRosterEntry
from app.domains.book_runs.book_generation_contracts import (  # noqa: F401  facade re-export
    DEFAULT_GENERATION_LOCATION,
    DEFAULT_GENERATION_POV,
    DEFAULT_GENERATION_PREMISE,
    DEFAULT_GENERATION_TITLE_SEED,
    DEFAULT_GENERATION_TONE,
    RECAP_FULL_CHAPTERS_DEFAULT,
    RECAP_MAX_CHARS_DEFAULT,
    RECAP_OLDER_SUMMARY_MAX_CHARS,
    BookGenerationResult,
)
from app.domains.book_runs.book_generation_contracts import (
    assert_no_missing_chapters as _assert_no_missing_chapters,
)
from app.domains.book_runs.book_generation_contracts import (
    count_approved_chapters as _count_approved_chapters,
)
from app.domains.book_runs.book_generation_draft import (  # noqa: F401  facade re-export
    generate_chapter as _generate_chapter_impl,
)
from app.domains.book_runs.book_generation_draft import (
    retry_story_state_changes_schema as _retry_story_state_changes_schema_impl,
)
from app.domains.book_runs.book_generation_judge import (  # noqa: F401  facade re-export
    CATEGORY_DIMENSION as _CATEGORY_DIMENSION,
)
from app.domains.book_runs.book_generation_judge import (
    judge_and_repair_loop as _judge_and_repair_loop,
)
from app.domains.book_runs.book_generation_llm import (  # noqa: F401  facade re-export
    THINK_BLOCK_RE,
    THINK_CLOSE_RE,
    THINK_OPEN_RE,
)
from app.domains.book_runs.book_generation_llm import (
    call_llm as _call_llm,
)
from app.domains.book_runs.book_generation_llm import (
    env_value as _env_value,
)
from app.domains.book_runs.book_generation_llm import (
    llm_request_headers as _llm_request_headers,
)
from app.domains.book_runs.book_generation_llm import (
    optional_float as _optional_float,
)
from app.domains.book_runs.book_generation_llm import (
    optional_int as _optional_int,
)
from app.domains.book_runs.book_generation_llm import (
    required_env as _required_env,
)
from app.domains.book_runs.book_generation_llm import (
    total_cost_estimate as _total_cost_estimate,
)
from app.domains.book_runs.book_generation_memory import (
    extract_memory_atoms_for_chapter,
    memory_recall_chars_for_chapter,
)
from app.domains.book_runs.book_generation_metrics import (  # noqa: F401  facade re-export
    MARKDOWN_CHAPTER_HEADING_RE,
)
from app.domains.book_runs.book_generation_preflight import (  # noqa: F401  facade re-export
    LLM_SETTINGS_ENV_KEYS,
    REQUIRED_REAL_LLM_ENV,
    missing_book_generation_env,
    resolved_llm_env,
)
from app.domains.book_runs.book_generation_preflight import (
    assert_preflight as _assert_preflight,
)
from app.domains.book_runs.book_generation_progress import (  # noqa: F401  facade re-export
    pause_by_budget as _pause_by_budget,
)
from app.domains.book_runs.book_generation_progress import (
    pause_by_failure as _pause_by_failure,
)
from app.domains.book_runs.book_generation_progress import (
    pause_by_interrupt as _pause_by_interrupt,
)
from app.domains.book_runs.book_generation_records import (  # noqa: F401  facade re-export
    MODEL_RUN_SUMMARY_MAX_CHARS,
)
from app.domains.book_runs.book_generation_records import (
    finalize_scene_decision as _finalize_scene_decision,
)
from app.domains.book_runs.book_generation_records import (
    persist_draft_scene as _persist_draft_scene,
)
from app.domains.book_runs.book_generation_records import (
    record_model_run as _record_model_run,
)
from app.domains.book_runs.book_generation_records import (
    record_scene_packet as _record_scene_packet,
)
from app.domains.book_runs.book_generation_resume import resume_book_generation as _resume_book_generation_impl
from app.domains.book_runs.book_generation_serial_metrics import (  # noqa: F401  facade re-export
    arc_completion_rate as _arc_completion_rate,
)
from app.domains.book_runs.book_generation_serial_metrics import (
    chapter_generation_time_p50 as _chapter_generation_time_p50,
)
from app.domains.book_runs.book_generation_serial_metrics import (
    direct_memory_recall_budget_used as _direct_memory_recall_budget_used,
)
from app.domains.book_runs.book_generation_serial_metrics import (
    serial_integration_metrics as _serial_integration_metrics,
)
from app.domains.book_runs.book_generation_setup import (  # noqa: F401  facade re-export
    blueprint_payload as _blueprint_payload_impl,
)
from app.domains.book_runs.book_generation_setup import (
    chapter_for_generation as _chapter,
)
from app.domains.book_runs.book_generation_setup import (
    create_generation_book as _create_generation_book,
)
from app.domains.book_runs.book_generation_setup import (
    default_planning_arcs as _default_planning_arcs,
)
from app.domains.book_runs.book_generation_setup import (
    seed_consistency_data as _seed_consistency_data,
)
from app.domains.book_runs.errors import (  # noqa: F401  facade re-export
    BookGenerationError,
    BookGenerationPreflightError,
)
from app.domains.book_runs.models import BookRun  # noqa: F401  facade re-export
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.books.models import Book, Chapter  # noqa: F401  facade re-export
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown


def _blueprint_payload(
    book_id: int,
    chapter_count: int,
    *,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
):
    return _blueprint_payload_impl(
        book_id,
        chapter_count,
        target_word_count=target_word_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        planning_arcs=_default_planning_arcs,
    )


def _retry_story_state_changes_schema(
    source: Mapping[str, str | None],
    *,
    prose: str,
    invalid_changes: list[dict[str, object]],
    schema_errors: list[str],
    roster: list[StoryStateRosterEntry],
) -> list[dict[str, object]]:
    return _retry_story_state_changes_schema_impl(
        source,
        prose=prose,
        invalid_changes=invalid_changes,
        schema_errors=schema_errors,
        roster=roster,
        call_llm=_call_llm,
    )


def _generate_chapter(
    session: Session,
    source: Mapping[str, str | None],
    chapter_index: int,
    chapter: Chapter,
    *,
    book_run_id: int | None = None,
) -> dict[str, object]:
    return _generate_chapter_impl(
        session,
        source,
        chapter_index,
        chapter,
        book_run_id=book_run_id,
        call_llm=_call_llm,
        retry_story_state_changes_schema=_retry_story_state_changes_schema,
    )


def run_book_generation(
    session: Session,
    *,
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    max_chapter_count: int = 10,
    env: Mapping[str, str | None] | None = None,
) -> BookGenerationResult:
    """用真实 OpenAI 兼容 LLM 跑受控章节数的 BookRun 整书生成。"""

    source = resolved_llm_env(env)
    _assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
        max_chapter_count=max_chapter_count,
    )
    started_at = time.monotonic()
    book = _create_generation_book(session, chapter_count)
    _seed_consistency_data(session, book.id)
    blueprint = create_book_blueprint(
        session,
        _blueprint_payload(
            book.id,
            chapter_count,
            target_word_count=target_word_count,
            chapter_word_count_min=chapter_word_count_min,
            chapter_word_count_max=chapter_word_count_max,
        ),
    )
    lock_book_blueprint(session, blueprint.id)
    trigger_chapter_plan(session, blueprint.id)
    book_run = create_book_run(
        session,
        BookRunCreate(
            book_id=book.id,
            blueprint_id=blueprint.id,
            token_budget=token_budget,
            time_budget_sec=_optional_int(source, "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS", 900),
            chapter_budget=chapter_count,
        ),
    )
    completed_chapters: list[dict[str, object]] = []
    tokens_used = 0
    for chapter_index in range(1, chapter_count + 1):
        chapter_started_at = time.monotonic()
        chapter = _chapter(session, book.id, chapter_index)
        memory_recall_chars = memory_recall_chars_for_chapter(session, book.id, chapter.ordinal)
        try:
            generated = _generate_chapter(session, source, chapter_index, chapter, book_run_id=book_run.id)
            tokens_used += generated["token_usage"]
            scene = _persist_draft_scene(session, chapter, str(generated["content"]))
            model_run = _record_model_run(session, book_run, scene, source, generated)
            scene_packet = _record_scene_packet(
                session,
                book_run,
                scene,
                story_state_changes=list(generated.get("story_state_changes") or []),
                story_state_changes_source=str(generated.get("story_state_changes_source") or ""),
            )
            outcome = _judge_and_repair_loop(session, source, book_run, scene, scene_packet)
            observe_book_generation_chapter(
                judge_call_count=int(outcome.get("judge_call_count") or 0),
                repair_patch_count=len(outcome.get("repair_patch_ids") or []),
                cost_cny_estimated=float(generated.get("cost_cny_estimated") or 0.0),
            )
            approved = _finalize_scene_decision(session, chapter, scene, int(outcome["quality_score"]))
            memory_atom_ids = (
                extract_memory_atoms_for_chapter(
                    session,
                    book_id=book.id,
                    chapter_id=chapter.id,
                    chapter_ordinal=chapter.ordinal,
                    approved_scene_id=int(scene.id),
                    content=scene.content or str(generated["content"]),
                )
                if approved
                else []
            )
        except BookGenerationError as exc:
            _pause_by_failure(session, book_run.id, chapter_index, completed_chapters, tokens_used, str(exc))
            raise BookGenerationError(
                f"真实 LLM 生成在第 {chapter_index} 章失败，已保住前 {len(completed_chapters)} 章证据：{exc}"
            ) from exc
        except (KeyboardInterrupt, SystemExit):
            _pause_by_interrupt(session, book_run.id, chapter_index, completed_chapters, tokens_used)
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
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise BookGenerationError("真实 LLM 生成触发 token 预算暂停，不能标记为 completed。")
    _assert_no_missing_chapters(session, book_run.id, chapter_count, completed_chapters, tokens_used)
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
                    "estimated_cost": _total_cost_estimate(completed_chapters),
                },
                "integration_metrics": _serial_integration_metrics(
                    session,
                    book_run,
                    completed_chapters,
                ),
                "real_llm_smoke": {
                    "provider_name": _required_env(source, "STORYFORGE_LLM_PROVIDER"),
                    "model_name": _required_env(source, "STORYFORGE_LLM_MODEL"),
                    "chapter_count": chapter_count,
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
        approved_chapter_count=_count_approved_chapters(completed_chapters),
    )


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
) -> BookGenerationResult:
    return _resume_book_generation_impl(
        session,
        book_run_id=book_run_id,
        chapter_count=chapter_count,
        token_budget=token_budget,
        target_word_count=target_word_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        max_chapter_count=max_chapter_count,
        env=env,
        generate_chapter=_generate_chapter,
    )


_COMPAT_EXPORTS = {
    "_JudgeRunResult": generation_judge.JudgeRunResult,
    "_aggregate_cost_breakdown": generation_metrics.aggregate_cost_breakdown,
    "_apply_word_count_floor": generation_judge.apply_word_count_floor,
    "_arc_points": generation_setup.arc_points,
    "_artifact_payload_sha256": generation_metrics.artifact_payload_sha256,
    "_artifact_text": generation_metrics.artifact_text,
    "_body_char_count": generation_metrics.body_char_count,
    "_book_id_for_scene": generation_judge.book_id_for_scene,
    "_build_judge_payload": generation_judge.build_judge_payload,
    "_chapter_index": generation_metrics.chapter_index,
    "_chapter_metric": generation_metrics.chapter_metric,
    "_cost_breakdown": generation_llm.cost_breakdown,
    "_evidence_summary": generation_metrics.evidence_summary,
    "_failure_count": generation_metrics.failure_count,
    "_fast_judge_enabled": generation_judge.fast_judge_enabled,
    "_float_value": generation_metrics.float_value,
    "_integration_metrics_from_audit_artifact": generation_metrics.integration_metrics_from_audit_artifact,
    "_latency_summary": generation_metrics.latency_summary,
    "_markdown_chapter_body_char_counts": generation_metrics.markdown_chapter_body_char_counts,
    "_maybe_repair": generation_judge.maybe_repair,
    "_model_run_summary_text": generation_records.model_run_summary_text,
    "_per_chapter_char_counts": generation_metrics.per_chapter_char_counts,
    "_prior_chapters_recap": generation_draft.prior_chapters_recap,
    "_quality_score": generation_judge.quality_score,
    "_reconstruct_completed_chapters": generation_setup.reconstruct_completed_chapters,
    "_record_summary_judge": generation_judge.record_summary_judge,
    "_result_summary": generation_metrics.result_summary,
    "_run_real_judge": generation_judge.run_real_judge,
    "_story_state_tool_calls_enabled": generation_draft.story_state_tool_calls_enabled,
    "_strip_reasoning_leak": generation_llm.strip_reasoning_leak,
    "_sum_chapter_int": generation_metrics.sum_chapter_int,
    "_token_usage": generation_llm.token_usage,
}
globals().update(_COMPAT_EXPORTS)


MAX_REPAIR_ROUNDS = generation_judge.MAX_REPAIR_ROUNDS
REPAIR_THRESHOLD = generation_judge.REPAIR_THRESHOLD
WORD_COUNT_CEILING_RUNAWAY_FACTOR = generation_judge.WORD_COUNT_CEILING_RUNAWAY_FACTOR
arc_completion_rate = _arc_completion_rate
assert_preflight = _assert_preflight
blueprint_payload = _blueprint_payload
call_llm = _call_llm
chapter_for_generation = _chapter
chapter_generation_time_p50 = _chapter_generation_time_p50
create_generation_book = _create_generation_book
default_planning_arcs = _default_planning_arcs
direct_memory_recall_budget_used = _direct_memory_recall_budget_used
env_value = _env_value
finalize_scene_decision = _finalize_scene_decision
generate_chapter = _generate_chapter
judge_and_repair_loop = _judge_and_repair_loop
llm_request_headers = _llm_request_headers
optional_float = _optional_float
optional_int = _optional_int
persist_draft_scene = _persist_draft_scene
prior_chapters_recap = generation_draft.prior_chapters_recap
record_model_run = _record_model_run
record_scene_packet = _record_scene_packet
reconstruct_completed_chapters = generation_setup.reconstruct_completed_chapters
required_env = _required_env
seed_consistency_data = _seed_consistency_data


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object] = run_book_generation,
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    from app.domains.book_runs.book_generation_cli import main as cli_main

    return cli_main(
        argv,
        session_factory=session_factory,
        runner=runner,
        output=output,
        error=error,
        env=env,
    )


if __name__ == "__main__":
    raise SystemExit(main())
