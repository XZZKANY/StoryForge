"""Judge & Repair 编排簇。

从 book_generation.py 提取，承载 judge&repair 循环、质量评分、字数门禁、
确定性/语义 judge 编排、修复 patch 创建。不反向依赖 book_generation.py。
book_generation.py 通过 facade re-export 保持可达性（宪法第 5/6 条）。
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.blueprints.models import BookBlueprint
from app.domains.book_runs.book_generation_llm import _env_value
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.deterministic import CONFLICT_ONLY_FACT_PREFIX
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import (
    JUDGE_SYSTEM_FAILURE_CATEGORY,
    DetectedIssue,
    _detect_character_alias_conflicts,
    _detect_character_bible_violations,
    _detect_style_fingerprint_drift,
    _detect_timeline_conflicts,
    _forbidden_trait_phrases,
    deterministic_judge_fallback,
    semantic_judge_with_status,
)
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch
from app.domains.story_state.models import StoryStateLedger
from app.domains.story_state.semantic import semantic_ground_story_state_changes
from app.domains.story_state.service import (
    StoryStateGroundingError,
    StoryStateInvariantError,
    commit_story_state_changes,
)
from app.domains.style_packs.service import list_style_packs

# Judge 常量
REPAIR_THRESHOLD = 70
MAX_REPAIR_ROUNDS = 3
WORD_COUNT_CEILING_RUNAWAY_FACTOR = 2.5

# 严重性扣分表与维度映射
_SEVERITY_PENALTY = {"high": 15, "medium": 8, "low": 3}
_CATEGORY_DIMENSION = {
    "setting_conflict": "world_consistency",
    "timeline_conflict": "timeline_consistency",
    "relationship_conflict": "character_consistency",
    "character_addressing_conflict": "character_consistency",
    "character_consistency": "character_consistency",
    "character_voice_violation": "character_consistency",
    "style_drift": "style_consistency",
    "forbidden_draft_term": "style_consistency",
    "story_state_conflict": "world_consistency",
    "cross_chapter_state_conflict": "world_consistency",
    "foreshadow_payoff_gap": "narrative_quality",
    "arc_continuity_drift": "narrative_quality",
    "repetition_echo": "style_consistency",
    "judge_system_failure": "system_reliability",
}
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}
_STORY_STATE_TERM_RE = re.compile(r"[\u4e00-\u9fff]{2,12}(?:规约|协议|许可|盟约|钟楼|密钥|线索|信号)")


@dataclass(frozen=True)
class _JudgeRunResult:
    """单轮 Judge 结果，供 _judge_and_repair_loop 聚合。"""

    issues: list[JudgeIssue]
    quality_score: int
    quality_issues: list[dict[str, object]]
    fast_path_reason: str | None = None
    semantic_advisory: dict[str, object] | None = None


def _judge_and_repair_loop(
    session: Session,
    source: Mapping[str, str | None],
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> dict[str, object]:
    """多轮 Judge→Repair 循环，直到 score ≥ 阈值或达到最大轮数。"""

    repair_patch_ids: list[int] = []
    final_issues: list[JudgeIssue] = []
    final_quality_score = 100
    final_quality_issues: list[dict[str, object]] = []
    final_fast_path_reason: str | None = None
    final_semantic_advisory: dict[str, object] | None = None
    final_story_state_commit: dict[str, object] | None = None
    judge_call_count = 0

    for _round_num in range(MAX_REPAIR_ROUNDS):
        session.refresh(scene)
        judge_result = _run_real_judge(session, source, book_run, scene, scene_packet)
        judge_call_count += 1
        final_issues = judge_result.issues
        final_quality_score = judge_result.quality_score
        final_quality_issues = judge_result.quality_issues
        final_fast_path_reason = judge_result.fast_path_reason
        final_semantic_advisory = judge_result.semantic_advisory

        if final_quality_score >= REPAIR_THRESHOLD or not final_issues:
            break

        repair_patch_id, _repaired_content = _maybe_repair(session, scene, final_issues, scene.content or "")
        if repair_patch_id is not None:
            repair_patch_ids.append(repair_patch_id)
        else:
            break

    final_quality_score, final_quality_issues = _apply_word_count_floor(
        session, book_run, scene, final_quality_score, final_quality_issues
    )
    if final_quality_score >= REPAIR_THRESHOLD and not final_issues:
        state_commit, state_issue = _commit_story_state_for_scene(session, book_run, scene, scene_packet)
        final_story_state_commit = state_commit
        if state_issue is not None:
            final_issues = [state_issue]
            final_quality_score = REPAIR_THRESHOLD - 1
            final_quality_issues = [
                {
                    "issue_id": state_issue.id,
                    "category": state_issue.issue_type,
                    "severity": state_issue.severity,
                    "summary": state_issue.description,
                    "dimension": _CATEGORY_DIMENSION.get(state_issue.issue_type, "narrative_quality"),
                }
            ]

    judge_report_id = final_issues[0].id if final_issues else _record_summary_judge(
        session,
        scene,
        scene_packet,
        final_quality_score,
        fast_path_reason=final_fast_path_reason,
        semantic_advisory=final_semantic_advisory,
        story_state_commit=final_story_state_commit,
    ).id

    return {
        "judge_report_id": judge_report_id,
        "repair_patch_id": repair_patch_ids[-1] if repair_patch_ids else None,
        "repair_patch_ids": repair_patch_ids,
        "repair_rounds": len(repair_patch_ids),
        "judge_call_count": judge_call_count,
        "quality_score": final_quality_score,
        "quality_issues": final_quality_issues,
        "story_state_commit": final_story_state_commit,
    }


def _apply_word_count_floor(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    quality_score: int,
    quality_issues: list[dict[str, object]],
) -> tuple[int, list[dict[str, object]]]:
    """字数门禁：下限硬拒（防截断/太短），上限按护栏倍数放宽（只拦失控，不拦偏长）。

    Judge 评分管一致性/文风，但管不住「正文被截断/太短」这种结构性残缺——
    一段 50 字的占位正文可能毫无一致性问题却拿满分。下限给 score=100 加一道真实约束。

    上限不再用蓝图目标值直接拒批：真实模型在质量全 pass 时仍系统性写超目标，且超出
    部分多为密实正文。改为 目标上限 × WORD_COUNT_CEILING_RUNAWAY_FACTOR 作为失控线，
    只拦「无限重复/明显失控」，放过「写得好但偏长」。
    """

    blueprint = session.get(BookBlueprint, book_run.blueprint_id) if book_run.blueprint_id else None
    if blueprint is None:
        return quality_score, quality_issues

    char_count = len((scene.content or "").strip())
    floor = int(blueprint.chapter_word_count_min or 0)
    ceiling = int(blueprint.chapter_word_count_max or 0)
    runaway_ceiling = int(ceiling * WORD_COUNT_CEILING_RUNAWAY_FACTOR) if ceiling > 0 else 0
    violation: str | None = None
    if floor > 0 and char_count < floor:
        violation = f"正文 {char_count} 字低于下限 {floor} 字，疑似截断或未完成。"
    elif runaway_ceiling > 0 and char_count > runaway_ceiling:
        violation = (
            f"正文 {char_count} 字超过失控线 {runaway_ceiling} 字"
            f"（目标上限 {ceiling} × {WORD_COUNT_CEILING_RUNAWAY_FACTOR}），疑似重复或失控。"
        )

    if violation is None:
        return quality_score, quality_issues

    quality_issues = [
        *quality_issues,
        {
            "issue_id": None,
            "category": "word_count_violation",
            "severity": "high",
            "summary": violation,
            "dimension": "structural_completeness",
        },
    ]
    # 直接压到阈值以下，确保 _finalize_scene_decision 拒批，而非仅扣几分仍可能过线。
    return min(quality_score, REPAIR_THRESHOLD - 1), quality_issues


def _run_real_judge(
    session: Session,
    source: Mapping[str, str | None],
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> _JudgeRunResult:
    """对生成正文跑真实 Judge（语义模型 + 确定性检测器），算出质量分与问题清单。"""

    payload = _build_judge_payload(session, scene, scene_packet)

    # 构建 character_voice_constraints，包含 forbidden_traits
    book_id = _book_id_for_scene(session, scene.id)
    character_voice_constraints: list[dict] = []
    if book_id is not None:
        from app.domains.character_bible.service import list_character_bible_entries

        entries = list_character_bible_entries(session, book_id=book_id)
        for entry in entries:
            forbidden = _forbidden_trait_phrases(entry.forbidden_traits)
            if forbidden:
                character_voice_constraints.append({
                    "name": entry.canonical_name,
                    "forbidden_traits": forbidden,
                })

    deterministic_issues = deterministic_judge_fallback(payload)
    local_issues = [
        *deterministic_issues,
        *_detect_character_alias_conflicts(session, payload),
        *_detect_character_bible_violations(session, payload),
        *_detect_timeline_conflicts(session, payload),
        *_detect_style_fingerprint_drift(session, payload),
    ]
    # 旁路诚实性：本地门禁只有在「确实有可校验的本地规则」时才算数。
    # required_facts 与 style_rules 都为空 → 本地门禁等于没查，score=100 是假象，必须走语义 Judge。
    local_coverage = bool(payload.required_facts) or bool(payload.style_rules)
    if _fast_judge_enabled(source) and local_coverage and not local_issues:
        advisory = semantic_judge_with_status(payload, character_voice_constraints=character_voice_constraints)
        return _JudgeRunResult(
            issues=[],
            quality_score=100,
            quality_issues=[],
            fast_path_reason="local_gate_passed_semantic_advisory",
            semantic_advisory=_semantic_advisory_payload(advisory),
        )

    # 传递 character_voice_constraints 给 create_judge_issues
    # 注意：create_judge_issues 内部会调用 semantic_judge_with_status，
    # 但它用的是 _load_voice_constraints 读 voice_traits，不读 forbidden_traits。
    # 我们需要直接调用 semantic_judge_with_status 并传入 character_voice_constraints。
    # 手动执行 Judge 流程（复制 create_judge_issues 的逻辑，但传入 character_voice_constraints）
    outcome = semantic_judge_with_status(payload, character_voice_constraints=character_voice_constraints)
    detected = outcome.issues or deterministic_issues
    detected = [
        *detected,
        *[
            issue
            for issue in local_issues
            if issue.category not in {item.category for item in detected}
            or issue.matched_text not in {item.matched_text for item in detected}
        ],
    ]

    # 注入失败标记
    if outcome.failed:
        detected.append(
            DetectedIssue(
                category=JUDGE_SYSTEM_FAILURE_CATEGORY,
                severity="high",
                span_start=0,
                span_end=0,
                summary="语义评审调用失败（网络/超时/响应不可解析），仅执行确定性检测。",
                recommended_repair_mode="none",
                expected_text="",
                replacement_text="",
                matched_text="",
                metadata={"judge_degraded": True},
            )
        )

    # 写入数据库
    issues = [
        JudgeIssue(
            scene_id=payload.scene_id,
            scene_packet_id=payload.scene_packet_id,
            issue_type=item.category,
            severity=item.severity,
            status="open",
            description=item.summary,
            payload={
                "span_start": item.span_start,
                "span_end": item.span_end,
                "evidence_links": payload.evidence_links,
                "recommended_repair_mode": item.recommended_repair_mode,
                "expected_text": item.expected_text,
                "replacement_text": item.replacement_text,
                "matched_text": item.matched_text,
                **(item.metadata or {}),
            },
        )
        for item in detected
    ]
    session.add_all(issues)
    session.commit()
    for issue in issues:
        session.refresh(issue)

    quality_score = _quality_score(issues)
    quality_issues = [
        {
            "issue_id": issue.id,
            "category": issue.issue_type,
            "severity": issue.severity,
            "summary": issue.description,
            "dimension": _CATEGORY_DIMENSION.get(issue.issue_type, "narrative_quality"),
        }
        for issue in issues
    ]
    return _JudgeRunResult(issues=issues, quality_score=quality_score, quality_issues=quality_issues)


def _fast_judge_enabled(source: Mapping[str, str | None]) -> bool:
    """默认启用本地快速 Judge；显式设为 0/false/no/off 时恢复全量语义评审。"""

    value = _env_value(source, "STORYFORGE_LLM_SMOKE_FAST_JUDGE").lower()
    return value not in {"0", "false", "no", "off"}


def _semantic_advisory_payload(outcome: object) -> dict[str, object]:
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


def _commit_story_state_for_scene(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> tuple[dict[str, object], JudgeIssue | None]:
    """章节通过后提交保守 story_state CHANGES，并把硬失败转成可审计 Judge issue。"""

    book_id = _book_id_for_scene(session, scene.id)
    chapter = session.get(Chapter, scene.chapter_id)
    if book_id is None or chapter is None:
        return {"status": "skipped", "reason": "missing_book_or_chapter", "change_count": 0}, None
    changes = _story_state_changes_from_packet(scene_packet) or _story_state_changes_for_scene(chapter, scene.content or "")
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
    return {
        "status": "committed",
        "event_count": len(result.events),
        "ledger_updates": result.ledger_updates,
        "event_ids": [event.event_id for event in result.events],
        "change_count": len(changes),
        "grounding": [item.model_dump() for item in result.grounding],
    }, None


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


def _quality_score(issues: list[JudgeIssue]) -> int:
    """按严重性扣分，把评审问题压成 0-100 的质量分。"""

    score = 100
    for issue in issues:
        score -= _SEVERITY_PENALTY.get(issue.severity, 8)
    return max(0, score)


def _build_judge_payload(session: Session, scene: Scene, scene_packet: ScenePacket) -> JudgeIssueCreate:
    """从 Style Pack 编出 Judge 的风格规则。角色约束通过 character_voice_constraints 单独传递。"""

    book_id = _book_id_for_scene(session, scene.id)
    style_rules: list[str] = []
    required_facts = _story_state_required_facts(
        session,
        book_id=book_id,
        book_run_id=_book_run_id_from_scene_packet(scene_packet),
    )

    # Style Pack → style_rules
    if book_id is not None:
        packs = list_style_packs(session, book_id)
        if packs:
            pack_payload = packs[-1].payload if isinstance(packs[-1].payload, dict) else {}
            tone = pack_payload.get("语气") or pack_payload.get("tone")
            if isinstance(tone, str) and tone.strip():
                style_rules.append(f"保持{tone.strip()}语气")
            rules = pack_payload.get("规则") or pack_payload.get("rules") or []
            style_rules.extend(rule for rule in rules if isinstance(rule, str) and rule.strip())
            forbidden = pack_payload.get("禁用表达") or pack_payload.get("forbidden_phrases") or []
            style_rules.extend(f"禁用：{phrase}" for phrase in forbidden if isinstance(phrase, str) and phrase.strip())

    return JudgeIssueCreate(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        content=scene.content or "",
        required_facts=required_facts,
        style_rules=style_rules,
        evidence_links=_story_state_evidence_links(required_facts),
    )


def _book_id_for_scene(session: Session, scene_id: int) -> int | None:
    row = session.execute(
        select(Chapter.book_id).join(Scene, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id)
    ).first()
    return int(row[0]) if row is not None else None


def _book_run_id_from_scene_packet(scene_packet: ScenePacket) -> int | None:
    packet = scene_packet.packet if isinstance(scene_packet.packet, dict) else {}
    raw = packet.get("book_run_id")
    return int(raw) if isinstance(raw, int) and raw > 0 else None


def _story_state_required_facts(
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


def _story_state_evidence_links(required_facts: list[str]) -> list[dict[str, object]]:
    return [{"source": "story_state_ledger", "fact": fact} for fact in required_facts[:20]]


def _maybe_repair(
    session: Session,
    scene: Scene,
    issues: list[JudgeIssue],
    content: str,
) -> tuple[int | None, str]:
    """对最高严重性问题生成一次定向修复补丁，并把 span 替换写回正文。"""

    # Judge 系统失败标记没有可替换的 span，排除在修复目标之外，否则会浪费一轮修复。
    repairable = [issue for issue in issues if issue.issue_type != JUDGE_SYSTEM_FAILURE_CATEGORY]
    if not repairable:
        return None, content
    target = min(repairable, key=lambda issue: _SEVERITY_ORDER.get(issue.severity, 1))
    try:
        repair_patch = create_repair_patch(session, RepairPatchCreate(issue_id=target.id, content=content))
    except Exception:  # noqa: BLE001 — span 与正文不再匹配时跳过修复，保留原文与问题证据。
        return None, content
    patch = repair_patch.patch or {}
    span_start = int(patch.get("span_start", 0))
    span_end = int(patch.get("span_end", span_start))
    replacement_text = str(patch.get("replacement_text", ""))
    if span_start < 0 or span_end < span_start or span_end > len(content):
        return repair_patch.id, content
    repaired_content = content[:span_start] + replacement_text + content[span_end:]
    scene.content = repaired_content
    session.commit()
    session.refresh(scene)
    return repair_patch.id, repaired_content


def _record_summary_judge(
    session: Session,
    scene: Scene,
    scene_packet: ScenePacket,
    quality_score: int,
    *,
    fast_path_reason: str | None = None,
    semantic_advisory: dict[str, object] | None = None,
    story_state_commit: dict[str, object] | None = None,
) -> JudgeIssue:
    """Judge 未发现问题时仍落一条通过记录，作为审计链的 judge_report_id。"""

    payload: dict[str, object] = {"score": quality_score, "mode": "phase9b_real_llm_smoke"}
    if fast_path_reason is not None:
        payload["judge_fast_path"] = fast_path_reason
    if semantic_advisory is not None:
        payload["semantic_advisory"] = semantic_advisory
    if story_state_commit is not None:
        payload["story_state_commit"] = story_state_commit
    judge = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=None,
        issue_type="phase9b_real_judge_pass",
        severity="low",
        status="resolved",
        description="真实 Judge 未发现一致性或文风问题，章节通过。",
        payload=payload,
    )
    session.add(judge)
    session.commit()
    session.refresh(judge)
    return judge
