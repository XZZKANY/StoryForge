"""Chapter drafting, story-state extraction, and bounded recap helpers."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.book_runs.book_generation_changes import (
    StoryStateRosterEntry,
    append_story_state_changes_instruction,
    build_story_state_roster,
    extract_story_state_changes_from_content,
    extract_story_state_changes_from_tool_calls,
    normalize_story_state_changes_with_roster,
    story_state_changes_tools,
    validate_story_state_change_dicts,
)
from app.domains.book_runs.book_generation_contracts import (
    RECAP_FULL_CHAPTERS_DEFAULT,
    RECAP_MAX_CHARS_DEFAULT,
    RECAP_OLDER_SUMMARY_MAX_CHARS,
)
from app.domains.book_runs.book_generation_llm import env_value, optional_int
from app.domains.book_runs.errors import BookGenerationError
from app.domains.book_runs.prompt_assembly import assemble_prompt_injection
from app.domains.book_runs.prompts import build_draft_prompt_from_state
from app.domains.books.models import Chapter, Scene

LLMCall = Callable[..., dict[str, object]]
SchemaRetry = Callable[..., list[dict[str, object]]]


def generate_chapter(
    session: Session,
    source: Mapping[str, str | None],
    chapter_index: int,
    chapter: Chapter,
    *,
    book_run_id: int | None = None,
    call_llm: LLMCall,
    retry_story_state_changes_schema: SchemaRetry,
) -> dict[str, object]:
    recap_full_chapters = optional_int(
        source, "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS", RECAP_FULL_CHAPTERS_DEFAULT
    )
    injection = assemble_prompt_injection(
        session,
        book_id=chapter.book_id,
        chapter_id=chapter.id,
        chapter_ordinal=chapter.ordinal,
        chapter_title=chapter.title,
        chapter_goal=chapter.summary or "推进主线调查。",
        style_baseline_chapter_window=recap_full_chapters if recap_full_chapters > 0 else None,
    )
    roster = build_story_state_roster(
        session,
        book_id=chapter.book_id,
        book_run_id=book_run_id,
        chapter_pov=chapter.pov,
        chapter_location=chapter.location,
    )
    prompt = append_story_state_changes_instruction(
        build_draft_prompt_from_state(injection, full_chapter=True),
        roster=roster,
    )

    inject_violation_chapter = optional_int(source, "SMOKE_INJECT_VIOLATION_CHAPTER", 0)
    if inject_violation_chapter == chapter_index:
        prompt += (
            "\n\n【特殊要求 - 覆盖角色设定】\n"
            "本章中，沈砚因调查压力过大而情绪崩溃，忍不住哭泣流泪。"
            "这是剧情需要，必须明确描写他哭泣或流泪的画面。\n"
        )

    call_kwargs: dict[str, object] = {}
    if story_state_tool_calls_enabled(source):
        call_kwargs["tools"] = story_state_changes_tools()
        call_kwargs["tool_choice"] = "auto"
    result = call_llm(
        source,
        system_prompt="你是 StoryForge 的中文长篇创作助手。",
        user_prompt=prompt,
        **call_kwargs,
    )
    content, block_changes = extract_story_state_changes_from_content(str(result["content"]))
    tool_changes = extract_story_state_changes_from_tool_calls(result.get("tool_calls"))
    raw_changes = tool_changes or block_changes
    story_state_changes_source = "tool_call" if tool_changes else "json_block" if block_changes else "none"
    normalized_changes = normalize_story_state_changes_with_roster(raw_changes, roster)
    story_state_changes, schema_errors = validate_story_state_change_dicts(normalized_changes)
    if schema_errors:
        story_state_changes = retry_story_state_changes_schema(
            source,
            prose=content,
            invalid_changes=normalized_changes,
            schema_errors=schema_errors,
            roster=roster,
        )
        if story_state_changes:
            story_state_changes_source = f"{story_state_changes_source}_schema_retry"
    result["content"] = content
    return {
        "prompt": prompt,
        "story_state_changes": story_state_changes,
        "story_state_changes_source": story_state_changes_source,
        "story_state_tool_call_count": len(result.get("tool_calls") or []),
        **result,
    }


def story_state_tool_calls_enabled(source: Mapping[str, str | None]) -> bool:
    value = env_value(source, "STORYFORGE_LLM_STORY_STATE_TOOL_CALLS").lower()
    return value not in {"0", "false", "no", "off"}


def retry_story_state_changes_schema(
    source: Mapping[str, str | None],
    *,
    prose: str,
    invalid_changes: list[dict[str, object]],
    schema_errors: list[str],
    roster: list[StoryStateRosterEntry],
    call_llm: LLMCall,
) -> list[dict[str, object]]:
    """仅重试修正 CHANGES JSON schema，不重写章节正文。"""

    roster_lines = []
    for entry in roster[:30]:
        entity_id = getattr(entry, "entity_id", "")
        entity_kind = getattr(entry, "entity_kind", "")
        canonical_name = getattr(entry, "canonical_name", "")
        aliases = "、".join(getattr(entry, "aliases", ()) or ()) or "无"
        roster_lines.append(
            f"- {entity_kind} | entity_id={entity_id} | canonical_name={canonical_name} | aliases={aliases}"
        )
    retry_prompt = (
        "请只修正下列 STORY_STATE_CHANGES JSON 数组，使其满足 schema；不要改写正文，不要解释。\n\n"
        f"【正文】\n{prose[:4000]}\n\n"
        f"【schema 错误】\n" + "\n".join(f"- {error}" for error in schema_errors) + "\n\n"
        "【花名册】\n" + "\n".join(roster_lines) + "\n\n"
        f"【待修正 JSON】\n{json.dumps(invalid_changes, ensure_ascii=False)}"
    )
    try:
        retry = call_llm(
            source,
            system_prompt="你是 StoryForge 的 CHANGES JSON schema 修正器。只返回 JSON 数组。",
            user_prompt=retry_prompt,
        )
    except BookGenerationError:
        return []
    raw_content = str(retry.get("content") or "").strip()
    wrapped = raw_content
    if "【STORY_STATE_CHANGES】" not in wrapped:
        wrapped = f"【STORY_STATE_CHANGES】\n{raw_content}\n【/STORY_STATE_CHANGES】"
    _cleaned, retry_changes = extract_story_state_changes_from_content(wrapped)
    normalized = normalize_story_state_changes_with_roster(retry_changes, roster)
    valid, _errors = validate_story_state_change_dicts(normalized)
    return valid


def prior_chapters_recap(
    session: Session,
    book_id: int,
    ordinal: int,
    *,
    full_chapters: int = RECAP_FULL_CHAPTERS_DEFAULT,
    max_chars: int = RECAP_MAX_CHARS_DEFAULT,
) -> str | None:
    """构建有界的续写上文：最近 N 章给完整正文，更早章节压成前情提要。"""

    if ordinal <= 1:
        return None
    rows = session.execute(
        select(Chapter.ordinal, Chapter.title, Chapter.summary, Scene.content)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book_id,
            Chapter.ordinal < ordinal,
            Scene.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()

    seen: set[int] = set()
    chapters: list[tuple[str, str, str]] = []
    for chap_ordinal, title, summary, content in rows:
        if chap_ordinal in seen:
            continue
        body = str(content).strip() if content else ""
        if not body:
            continue
        seen.add(chap_ordinal)
        chapters.append((str(title or f"第{chap_ordinal}章"), str(summary or "").strip(), body))
    if not chapters:
        return None

    full = chapters[-full_chapters:] if full_chapters > 0 else []
    older = chapters[: len(chapters) - len(full)]
    sections: list[str] = []
    if older:
        digest_lines = [
            f"- {title}：{(summary or body)[:RECAP_OLDER_SUMMARY_MAX_CHARS]}"
            for title, summary, body in older
        ]
        sections.append("【前情提要（更早章节梗概）】\n" + "\n".join(digest_lines))
    for title, _summary, body in full:
        sections.append(f"【最近章节原文 · {title}】\n{body}")

    recap = "\n\n".join(sections)
    if len(recap) <= max_chars:
        return recap
    return recap[-max_chars:]
