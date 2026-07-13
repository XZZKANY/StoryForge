"""Story-state projection and commit helpers used by BookRun judging."""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.book_runs.models import BookRun
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.deterministic import CONFLICT_ONLY_FACT_PREFIX
from app.domains.judge.models import JudgeIssue
from app.domains.story_state.models import StoryStateLedger
from app.domains.story_state.semantic import semantic_ground_story_state_changes
from app.domains.story_state.service import (
    StoryStateGroundingError,
    StoryStateInvariantError,
    commit_story_state_changes,
)

_STORY_STATE_TERM_RE = re.compile(r"[\u4e00-\u9fff]{2,12}(?:规约|协议|许可|盟约|钟楼|密钥|线索|信号)")


def semantic_advisory_payload(outcome: object) -> dict[str, object]:
    """把 fast path 语义评审结果记录为咨询信号，不参与扣分或修复。"""

    issues = list(getattr(outcome, "issues", []) or [])
    return {
        "mode": "advisory",
        "required": True,
        "failed": bool(getattr(outcome, "failed", False)),
        "issue_count": len(issues),
        "issues": [
            {
                "category": item.category,
                "severity": item.severity,
                "summary": item.summary,
                "matched_text": item.matched_text,
            }
            for item in issues
        ],
    }


def commit_story_state_for_scene(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> tuple[dict[str, object], JudgeIssue | None]:
    """章节通过后提交保守 story_state CHANGES，并把硬失败转成可审计 Judge issue。"""

    book_id = book_id_for_scene(session, scene.id)
    chapter = session.get(Chapter, scene.chapter_id)
    if book_id is None or chapter is None:
        return {"status": "skipped", "reason": "missing_book_or_chapter", "change_count": 0}, None
    changes = _story_state_changes_from_packet(scene_packet) or _story_state_changes_for_scene(
        chapter, scene.content or ""
    )
    if not changes:
        return {"status": "no_changes", "change_count": 0}, None
    try:
        result = commit_story_state_changes(
            session,
            book_id=book_id,
            book_run_id=book_run.id,
            chapter_index=chapter.ordinal,
            prose=scene.content or "",
            changes=changes,
            semantic_grounder=semantic_ground_story_state_changes,
            drop_ungroundable=True,
        )
    except StoryStateGroundingError as exc:
        payload = {
            "status": "failed",
            "reason": "grounding_failed",
            "grounding": [item.model_dump() for item in exc.grounding],
            "change_count": len(changes),
        }
        return payload, _record_story_state_conflict_issue(session, scene, scene_packet, str(exc), payload)
    except StoryStateInvariantError as exc:
        payload = {
            "status": "failed",
            "reason": "invariant_failed",
            "change_count": len(changes),
        }
        return payload, _record_story_state_conflict_issue(session, scene, scene_packet, str(exc), payload)
    payload: dict[str, object] = {
        "status": "committed",
        "event_count": len(result.events),
        "ledger_updates": result.ledger_updates,
        "event_ids": [event.event_id for event in result.events],
        "change_count": len(changes),
        "grounding": [item.model_dump() for item in result.grounding],
    }
    if result.dropped_grounding:
        payload["status"] = "committed_with_dropped" if result.events else "all_dropped"
        payload["dropped_grounding"] = [item.model_dump() for item in result.dropped_grounding]
    return payload, None


def _story_state_changes_for_scene(chapter: Chapter, content: str) -> list[dict[str, object]]:
    """从章节上下文生成最小、可接地的 CHANGES 桥，等待后续 LLM 工具调用替换。"""

    changes: list[dict[str, object]] = []
    pov = _clean_story_state_text(chapter.pov)
    if pov and pov in content:
        changes.append(
            {
                "change_type": "character.observe",
                "entity_kind": "character",
                "entity_id": pov,
                "canonical_name": pov,
                "surface_forms": [pov],
                "payload": {
                    "status": _sentence_containing(content, pov) or "本章持续参与主线行动。",
                    "last_seen_chapter": chapter.ordinal,
                },
            }
        )
    location = _clean_story_state_text(chapter.location)
    if location and location in content:
        changes.append(
            {
                "change_type": "location.observe",
                "entity_kind": "location",
                "entity_id": location,
                "canonical_name": location,
                "surface_forms": [location],
                "payload": {
                    "status": _sentence_containing(content, location) or f"{location}是本章关键地点。",
                    "last_seen_chapter": chapter.ordinal,
                },
            }
        )
    seen_entities = {str(item["entity_id"]) for item in changes}
    for term in _story_state_world_terms(content):
        if term in seen_entities:
            continue
        changes.append(
            {
                "change_type": "world_fact.observe",
                "entity_kind": "world_rule",
                "entity_id": term,
                "canonical_name": term,
                "surface_forms": [term],
                "payload": {
                    "rule": _sentence_containing(content, term) or f"{term}在本章成为有效设定。",
                    "last_seen_chapter": chapter.ordinal,
                },
            }
        )
        seen_entities.add(term)
    return changes


def _story_state_changes_from_packet(scene_packet: ScenePacket) -> list[dict[str, object]]:
    packet = scene_packet.packet if isinstance(scene_packet.packet, dict) else {}
    raw_changes = packet.get("story_state_changes")
    if not isinstance(raw_changes, list):
        return []
    return [item for item in raw_changes if isinstance(item, dict)]


def _story_state_world_terms(content: str) -> list[str]:
    seen: set[str] = set()
    terms: list[str] = []
    for match in _STORY_STATE_TERM_RE.finditer(content):
        term = match.group(0)
        if term in seen:
            continue
        seen.add(term)
        terms.append(term)
        if len(terms) >= 3:
            break
    return terms


def _sentence_containing(content: str, term: str, *, max_chars: int = 120) -> str | None:
    for sentence in re.split(r"(?<=[。！？!?])", content):
        normalized = " ".join(sentence.split()).strip()
        if term in normalized:
            return normalized[:max_chars]
    return None


def _clean_story_state_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _record_story_state_conflict_issue(
    session: Session,
    scene: Scene,
    scene_packet: ScenePacket,
    description: str,
    payload: dict[str, object],
) -> JudgeIssue:
    issue = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        issue_type="story_state_conflict",
        severity="high",
        status="open",
        description=description,
        payload=payload,
    )
    session.add(issue)
    session.commit()
    session.refresh(issue)
    return issue


def book_id_for_scene(session: Session, scene_id: int) -> int | None:
    row = session.execute(
        select(Chapter.book_id).join(Scene, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id)
    ).first()
    return int(row[0]) if row is not None else None


def book_run_id_from_scene_packet(scene_packet: ScenePacket) -> int | None:
    packet = scene_packet.packet if isinstance(scene_packet.packet, dict) else {}
    raw = packet.get("book_run_id")
    return int(raw) if isinstance(raw, int) and raw > 0 else None


def story_state_required_facts(
    session: Session,
    *,
    book_id: int | None,
    book_run_id: int | None,
) -> list[str]:
    """从 story_state 当前态投影生成冲突-only 已知事实，供 judge 查矛盾。"""

    if book_id is None or book_run_id is None:
        return []
    ledgers = session.scalars(
        select(StoryStateLedger)
        .where(StoryStateLedger.book_id == book_id, StoryStateLedger.book_run_id == book_run_id)
        .order_by(StoryStateLedger.last_chapter.desc(), StoryStateLedger.id)
    ).all()
    facts: list[str] = []
    seen: set[str] = set()
    for ledger in ledgers:
        for fact in _ledger_fact_candidates(ledger):
            normalized = fact.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            facts.append(f"{CONFLICT_ONLY_FACT_PREFIX}{normalized}")
            if len(facts) >= 20:
                return facts
    return facts


def _ledger_fact_candidates(ledger: StoryStateLedger) -> list[str]:
    state = ledger.state if isinstance(ledger.state, dict) else {}
    candidates: list[str] = []
    for key in ("status", "rule", "phase"):
        value = _compact_fact_value(state.get(key))
        if value:
            candidates.append(value)
    holder = _compact_fact_value(state.get("holder"))
    if holder:
        candidates.append(f"{ledger.entity_id}持有者：{holder}")
    location = _compact_fact_value(state.get("location"))
    if location:
        candidates.append(f"{ledger.entity_id}位置：{location}")
    return candidates


def _compact_fact_value(value: object, *, max_chars: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split()).strip()
    if not normalized:
        return None
    return normalized[:max_chars]


def story_state_evidence_links(required_facts: list[str]) -> list[dict[str, object]]:
    return [{"source": "story_state_ledger", "fact": fact} for fact in required_facts[:20]]
