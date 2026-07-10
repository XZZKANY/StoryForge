"""Judge 域 service 层：评审入口编排。

把语义评审、确定性规则、跨域一致性检测组合成可写入的问题单列表。
内部实现已按职责拆到 types/semantic/deterministic/consistency/style_fingerprint，
本模块仅保留编排入口和 facade re-export。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.books.models import Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.consistency import (  # noqa: F401  facade re-export
    _book_id_for_scene,
    _contains_death_state,
    _dead_character_issue,
    _detect_character_alias_conflicts,
    _detect_character_bible_violations,
    _detect_style_fingerprint_drift,
    _detect_timeline_conflicts,
    _extract_labeled_value,
    _forbidden_replacement_map,
    _forbidden_trait_phrases,
    _load_voice_constraints,
    _observed_location_after_character,
    _parse_timeline_location,
    _same_time_location_issue,
    _scene_scope_for_judge,
    _timeline_fact_payload,
    _unique_strings,
)
from app.domains.judge.deterministic import (  # noqa: F401  facade re-export
    _detect_setting_conflicts,
    _detect_style_drift,
    _find_conflict_phrase,
    _find_field_conflict,
    _missing_fact_issue,
    deterministic_judge_fallback,
)
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.semantic import (  # noqa: F401  facade re-export
    _decode_semantic_judge_content,
    _first_json_array_fragment,
    _issue_from_llm_item,
    _issues_from_provider_items,
    _judge_llm_errors_total,
    _strip_json_markdown_fence,
    semantic_judge,
    semantic_judge_with_status,
)
from app.domains.judge.style_fingerprint import (  # noqa: F401  facade re-export
    _approved_style_sources,
    _first_style_drift_phrase,
    _marker_count,
    _relative_delta,
    _style_fingerprint,
    _style_sentences,
    _style_similarity_score,
    compute_book_style_baseline,
)
from app.domains.judge.types import (  # noqa: F401  facade re-export
    JUDGE_SYSTEM_FAILURE_CATEGORY,
    STYLE_DRIFT_PHRASES,
    STYLE_FINGERPRINT_DRIFT_PHRASES,
    STYLE_FINGERPRINT_THRESHOLD,
    STYLE_RESTRAINT_MARKERS,
    DetectedIssue,
    JudgeInputError,
    JudgeProvider,
    SemanticJudgeOutcome,
    StyleFingerprint,
)


def create_judge_issues(session: Session, payload: JudgeIssueCreate) -> list[JudgeIssue]:
    """优先使用 LLM 语义评审，缺少配置时回退到确定性规则。"""

    _validate_scene_packet(session, payload.scene_id, payload.scene_packet_id)
    voice_constraints = _load_voice_constraints(session, payload.scene_id)
    outcome = semantic_judge_with_status(payload, character_voice_constraints=voice_constraints)
    detected = outcome.issues or deterministic_judge_fallback(payload)
    detected = [
        *detected,
        *_detect_character_alias_conflicts(session, payload),
        *_detect_character_bible_violations(session, payload),
        *_detect_timeline_conflicts(session, payload),
        *_detect_style_fingerprint_drift(session, payload),
    ]
    # 语义评审调用失败时注入标记问题，让审计层看见降级而非误判为干净通过。
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
    return issues


def _validate_scene_packet(session: Session, scene_id: int, scene_packet_id: int | None) -> None:
    """确认评审目标存在，并确保上下文包归属同一场景。"""

    if session.get(Scene, scene_id) is None:
        raise JudgeInputError("场景不存在，无法执行结构化评审。")
    if scene_packet_id is None:
        return
    scene_packet = session.get(ScenePacket, scene_packet_id)
    if scene_packet is None or scene_packet.scene_id != scene_id:
        raise JudgeInputError("Scene Packet 不存在或不属于指定场景，无法执行结构化评审。")
