from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.redaction import redact_sensitive_text
from app.domains.book_runs.book_generation_judge import REPAIR_THRESHOLD, SEMANTIC_BLOCKING_CONFLICT_CATEGORIES
from app.domains.book_runs.book_generation_llm import required_env as _required_env
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue
from app.domains.judge.types import JUDGE_SYSTEM_FAILURE_CATEGORY
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run

MODEL_RUN_SUMMARY_MAX_CHARS = 50000


def _persist_draft_scene(session: Session, chapter: Chapter, content: str) -> Scene:
    """先把生成正文落为 draft 场景（不批准、不进 BookContext），供 Judge/Repair 操作。"""

    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title=f"{chapter.title} 真实 LLM 正文",
        status="draft",
        content=content,
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def _finalize_scene_decision(
    session: Session,
    chapter: Chapter,
    scene: Scene,
    quality_score: int,
) -> bool:
    """门禁后置：仅当 Judge 无未关闭的硬阻断且评分达标才批准并追加进 BookContext；否则标 needs_revision 且不进上下文。

    坏章不进上下文是关键——否则它会污染后续每一章的 recap，把劣质蔓延到全书。
    """

    from app.domains.book_runs.book_context import get_book_context, skip_book_context_invalidation_once

    open_issues = session.scalars(
        select(JudgeIssue).where(JudgeIssue.scene_id == scene.id, JudgeIssue.status == "open")
    ).all()
    blocked = any(
        issue.issue_type == JUDGE_SYSTEM_FAILURE_CATEGORY
        or (issue.severity == "high" and issue.issue_type in SEMANTIC_BLOCKING_CONFLICT_CATEGORIES)
        for issue in open_issues
    )
    if blocked or quality_score < REPAIR_THRESHOLD:
        scene.status = "needs_revision"
        session.commit()
        session.refresh(scene)
        return False

    scene.status = "approved"
    chapter.status = "approved"
    skip_book_context_invalidation_once(session, chapter.book_id)
    session.commit()
    session.refresh(scene)

    # Phase 1 Context 增量化：仅达标章节追加进 BookContext 缓存，喂下一章 recap。
    context = get_book_context(session, chapter.book_id)
    context.append_chapter(
        session=session,
        chapter_id=chapter.id,
        ordinal=chapter.ordinal,
        title=chapter.title or f"第{chapter.ordinal}章",
        summary=chapter.summary or "",
        content=scene.content or "",
    )
    return True


def _record_model_run(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    source: Mapping[str, str | None],
    generated: dict[str, object],
    *, observed_run: ModelRun | None = None,
):
    secrets = [value for key, value in source.items() if key.endswith(("_API_KEY", "_AUTH_TOKEN")) and value]
    input_summary = _model_run_summary_text(redact_sensitive_text(str(generated["prompt"]), extra_secrets=secrets))
    output_summary = _model_run_summary_text(redact_sensitive_text(str(generated["content"]), extra_secrets=secrets))
    payload = ModelRunCreate(
        book_id=book_run.book_id,
        book_run_id=book_run.id,
        chapter_id=scene.chapter_id,
        scene_id=scene.id,
        provider_name=_required_env(source, "STORYFORGE_LLM_PROVIDER"),
        model_name=_required_env(source, "STORYFORGE_LLM_MODEL"),
        capability="llm",
        latency_ms=int(generated["latency_ms"]),
        token_usage=int(generated["token_usage"]),
        input_tokens=int(generated.get("prompt_tokens") or 0),
        output_tokens=int(generated.get("completion_tokens") or 0),
        cost_estimate=float(generated.get("cost_cny_estimated") or 0),
        input_summary=input_summary,
        output_summary=output_summary,
        payload={
            "book_run_id": book_run.id,
            "mode": "phase9b_real_llm_smoke",
            "token_usage_source": generated["token_usage_source"],
            "prompt_tokens": generated.get("prompt_tokens", 0),
            "completion_tokens": generated.get("completion_tokens", 0),
            "total_tokens": generated["token_usage"],
            "cost_cny_estimated": generated.get("cost_cny_estimated"),
            "cost_source": (
                generated.get("cost_breakdown", {}).get("source", "unavailable")
                if isinstance(generated.get("cost_breakdown"), dict)
                else "unavailable"
            ),
            "cost_breakdown": generated.get("cost_breakdown", {}),
            "story_state_changes_source": generated.get("story_state_changes_source"),
            "story_state_tool_call_count": generated.get("story_state_tool_call_count", 0),
            "input_summary_original_length": len(str(generated["prompt"])),
            "output_summary_original_length": len(str(generated["content"])),
            "input_summary_truncated": len(input_summary) < len(str(generated["prompt"])),
            "output_summary_truncated": len(output_summary) < len(str(generated["content"])),
        },
    )
    if observed_run is None:
        return create_model_run(session, payload)
    if observed_run.book_run_id != book_run.id or observed_run.chapter_id != scene.chapter_id:
        raise ValueError("Observed draft belongs to another BookRun or chapter.")
    observed_run.scene_id = scene.id
    observed_run.input_summary, observed_run.output_summary = input_summary, output_summary
    observed_run.payload = {**payload.payload, **observed_run.payload}
    session.commit()
    return observed_run


def _model_run_summary_text(text: str) -> str:
    """ModelRun 摘要字段有 50000 字符上限；真实 prompt 本身不在这里裁剪。"""

    if len(text) <= MODEL_RUN_SUMMARY_MAX_CHARS:
        return text
    marker = f"\n\n[摘要已截断：原始长度 {len(text)} 字符，仅保留开头和结尾用于审计]\n\n"
    remaining = MODEL_RUN_SUMMARY_MAX_CHARS - len(marker)
    head_length = remaining // 2
    tail_length = remaining - head_length
    return text[:head_length] + marker + text[-tail_length:]


def _record_scene_packet(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    *,
    story_state_changes: list[dict[str, object]] | None = None,
    story_state_changes_source: str | None = None,
) -> ScenePacket:
    packet_payload: dict[str, object] = {"book_run_id": book_run.id, "真实 LLM 生成": True, "证据链接": []}
    if story_state_changes_source:
        packet_payload["story_state_changes_source"] = story_state_changes_source
    if story_state_changes:
        packet_payload["story_state_changes"] = story_state_changes
    packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet=packet_payload,
        version=1,
    )
    session.add(packet)
    session.commit()
    session.refresh(packet)
    return packet


finalize_scene_decision = _finalize_scene_decision
model_run_summary_text = _model_run_summary_text
persist_draft_scene = _persist_draft_scene
record_model_run = _record_model_run
record_scene_packet = _record_scene_packet
