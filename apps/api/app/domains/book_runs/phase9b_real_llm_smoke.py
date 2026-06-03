from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TextIO
from urllib import request

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.artifacts.models import Artifact
from app.domains.blueprints.schemas import BookBlueprintCreate
from app.domains.blueprints.service import create_book_blueprint, lock_book_blueprint, trigger_chapter_plan
from app.domains.book_runs.models import BookRun
from app.domains.book_runs.prompt_assembly import assemble_prompt_injection
from app.domains.book_runs.schemas import BookRunCreate, BookRunProgressUpdate
from app.domains.book_runs.service import apply_book_run_progress, create_book_run
from app.domains.book_runs.workflow_prompt_bridge import build_draft_prompt_from_state
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.schemas import CharacterBibleCreate
from app.domains.character_bible.service import create_character_bible_entry
from app.domains.continuity.models import ScenePacket
from app.domains.exports.book_markdown_exporter import export_book_run_audit_report, export_book_run_markdown
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import (
    JUDGE_SYSTEM_FAILURE_CATEGORY,
    DetectedIssue,
    _detect_character_bible_violations,
    _detect_style_fingerprint_drift,
    _detect_timeline_conflicts,
    _forbidden_trait_phrases,
    deterministic_judge_fallback,
    semantic_judge_with_status,
)
from app.domains.model_runs.schemas import ModelRunCreate
from app.domains.model_runs.service import create_model_run
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch
from app.domains.style_packs.schemas import StylePackCreate
from app.domains.style_packs.service import create_style_pack, list_style_packs

REQUIRED_REAL_LLM_ENV = (
    "STORYFORGE_LLM_API_KEY",
    "STORYFORGE_LLM_BASE_URL",
    "STORYFORGE_LLM_MODEL",
    "STORYFORGE_LLM_PROVIDER",
)

REPAIR_THRESHOLD = 70
MAX_REPAIR_ROUNDS = 3


class Phase9BRealLlmSmokePreflightError(RuntimeError):
    """真实 LLM 冒烟缺少私有运行配置。"""


class Phase9BRealLlmSmokeError(RuntimeError):
    """真实 LLM 冒烟运行失败，不能写入完成证据。"""


@dataclass(frozen=True)
class Phase9BRealLlmSmokeResult:
    """9B 真实 LLM 冒烟产物，供验证报告引用。"""

    book_run: BookRun
    markdown_artifact: Artifact
    audit_artifact: Artifact
    chapter_count: int


def missing_phase9b_real_llm_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    """列出真实 LLM 冒烟所需但尚未配置的环境变量名。"""

    source = os.environ if env is None else env
    return [name for name in REQUIRED_REAL_LLM_ENV if not _env_value(source, name)]


def run_phase9b_real_llm_smoke(
    session: Session,
    *,
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
    env: Mapping[str, str | None] | None = None,
) -> Phase9BRealLlmSmokeResult:
    """用真实 OpenAI 兼容 LLM 跑受控章节数的 BookRun 冒烟。"""

    source = os.environ if env is None else env
    _assert_preflight(
        source,
        chapter_count,
        token_budget,
        target_word_count,
        chapter_word_count_min,
        chapter_word_count_max,
    )
    started_at = time.monotonic()
    book = _create_smoke_book(session, chapter_count)
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
        chapter = _chapter(session, book.id, chapter_index)
        generated = _generate_chapter(session, source, chapter_index, chapter)
        tokens_used += generated["token_usage"]
        scene = _approve_scene(session, chapter, str(generated["content"]))
        model_run = _record_model_run(session, book_run, scene, source, generated)
        scene_packet = _record_scene_packet(session, book_run, scene)
        outcome = _judge_and_repair_loop(session, book_run, scene, scene_packet)
        completed_chapters.append(
            {
                "chapter_index": chapter_index,
                "model_run_id": model_run.id,
                "judge_report_id": outcome["judge_report_id"],
                "repair_patch_id": outcome["repair_patch_id"],
                "repair_patch_ids": outcome["repair_patch_ids"],
                "repair_rounds": outcome["repair_rounds"],
                "approved_scene_id": scene.id,
                "token_usage": generated["token_usage"],
                "elapsed_time_sec": max(0, int(time.monotonic() - started_at)),
                "cost_estimate": 0.0,
                "quality_score": outcome["quality_score"],
                "quality_issues": outcome["quality_issues"],
            }
        )
        if tokens_used > token_budget:
            _pause_by_budget(session, book_run.id, chapter_index, completed_chapters, tokens_used)
            raise Phase9BRealLlmSmokeError("真实 LLM 冒烟触发 token 预算暂停，不能标记为 completed。")
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
                    "estimated_cost": 0.0,
                },
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
    return Phase9BRealLlmSmokeResult(
        book_run=book_run,
        markdown_artifact=markdown_artifact,
        audit_artifact=audit_artifact,
        chapter_count=chapter_count,
    )


def _assert_preflight(
    source: Mapping[str, str | None],
    chapter_count: int,
    token_budget: int,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
) -> None:
    missing = missing_phase9b_real_llm_env(source)
    if missing:
        joined = ", ".join(missing)
        raise Phase9BRealLlmSmokePreflightError(f"缺少真实 LLM 冒烟环境变量：{joined}。")
    if chapter_count < 1 or chapter_count > 10:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟只允许 1 到 10 章。")
    if token_budget <= 0:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟必须设置正数 token_budget。")
    if target_word_count is not None and target_word_count <= 0:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟必须设置正数 target_word_count。")
    if chapter_word_count_min <= 0 or chapter_word_count_max <= 0:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟章节字数上下限必须为正数。")
    if chapter_word_count_min > chapter_word_count_max:
        raise Phase9BRealLlmSmokePreflightError("真实 LLM 冒烟章节最小字数不能大于最大字数。")


def _create_smoke_book(session: Session, chapter_count: int) -> Book:
    book = Book(
        title=f"Phase 9B 真实 LLM 冒烟 {chapter_count} 章",
        status="draft",
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def _seed_consistency_data(session: Session, book_id: int) -> None:
    """为冒烟书写入一条 Character Bible 与一个 Style Pack，让真实一致性数据进入 prompt。"""

    create_character_bible_entry(
        session,
        CharacterBibleCreate(
            book_id=book_id,
            canonical_name="林岚",
            aliases=["雾港调查员"],
            voice_traits={"语气": "克制", "句式": ["短句", "少解释"]},
            forbidden_traits={
                "禁止": [
                    "突然健谈",
                    "忘记左臂旧伤",
                    "主动解释动机",
                    "长篇大论",
                    "情绪外露",
                    "微笑",
                    "大笑",
                    "哭泣",
                    "流泪",
                ],
                "替换": {
                    "突然健谈": "她只说了必要的话",
                    "主动解释动机": "她没有解释",
                    "长篇大论": "她说得很简短",
                    "微笑": "她面无表情",
                    "大笑": "她没有笑",
                    "哭泣": "她咬紧牙关",
                    "流泪": "她眼眶发红但没有流泪",
                },
            },
        ),
    )
    create_style_pack(
        session,
        StylePackCreate(
            book_id=book_id,
            name="雾港克制悬疑风格",
            payload={
                "语气": "克制悬疑",
                "视角": "第三人称贴身",
                "规则": ["多用动作与画面", "对话推动信息", "避免心理描写", "不写情绪词结尾"],
                "禁用表达": [
                    "不禁",
                    "情不自禁",
                    "忽然",
                    "仿佛",
                    "莫名",
                    "五味杂陈",
                    "心中一震",
                    "缓缓",
                    "深深地",
                ],
                "示例句": ["她把左臂藏进披风，没有解释。"],
            },
        ),
    )


def _blueprint_payload(
    book_id: int,
    chapter_count: int,
    *,
    target_word_count: int | None = None,
    chapter_word_count_min: int = 600,
    chapter_word_count_max: int = 1600,
) -> BookBlueprintCreate:
    return BookBlueprintCreate(
        book_id=book_id,
        premise="林岚在雾港追查失真的灯塔信号，并把每一步证据写入审计链。",
        tone="克制悬疑",
        target_word_count=target_word_count or max(1200, chapter_count * 1200),
        target_chapter_count=chapter_count,
        chapter_word_count_min=chapter_word_count_min,
        chapter_word_count_max=chapter_word_count_max,
        metadata={"pov": "林岚", "location": "雾港", "title_seed": "真实冒烟"},
    )


def _chapter(session: Session, book_id: int, chapter_index: int) -> Chapter:
    chapter = (
        session.query(Chapter)
        .filter(Chapter.book_id == book_id, Chapter.ordinal == chapter_index)
        .order_by(Chapter.id)
        .one()
    )
    chapter.status = "approved"
    return chapter


def _call_llm(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, object]:
    """对真实 OpenAI 兼容端点发一次 chat/completions，返回正文与 token 使用。"""

    payload = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7),
    }
    max_completion_tokens = _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    if max_completion_tokens > 0:
        payload["max_completion_tokens"] = max_completion_tokens
    reasoning_effort = _env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {_required_env(source, 'STORYFORGE_LLM_API_KEY')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    timeout = _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 60.0)
    started_at = time.monotonic()
    with request.urlopen(http_request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise Phase9BRealLlmSmokeError("真实 LLM 返回内容为空，不能继续 BookRun 冒烟。")
    token_usage, token_usage_source = _token_usage(data, user_prompt, content)
    return {
        "content": content.strip(),
        "token_usage": token_usage,
        "token_usage_source": token_usage_source,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }


def _generate_chapter(
    session: Session,
    source: Mapping[str, str | None],
    chapter_index: int,
    chapter: Chapter,
) -> dict[str, object]:
    injection = assemble_prompt_injection(
        session,
        book_id=chapter.book_id,
        chapter_id=chapter.id,
        chapter_title=chapter.title,
        chapter_goal=chapter.summary or "推进主线调查。",
        prior_chapter_text=_prior_chapters_text(session, chapter.book_id, chapter.ordinal),
    )
    prompt = build_draft_prompt_from_state(injection, full_chapter=True)

    # 测试探针：故意注入违规指令，验证 Judge 检测 + Repair 修复能力。
    # 仅在 SMOKE_INJECT_VIOLATION_CHAPTER 指定的章节触发，默认关闭。
    inject_violation_chapter = _optional_int(source, "SMOKE_INJECT_VIOLATION_CHAPTER", 0)
    if inject_violation_chapter == chapter_index:
        violation_override = (
            "\n\n【特殊要求 - 覆盖角色设定】\n"
            "本章中，林岚因调查压力过大而情绪崩溃，忍不住哭泣流泪。"
            "这是剧情需要，必须明确描写她哭泣或流泪的画面。\n"
        )
        prompt = prompt + violation_override

    result = _call_llm(
        source,
        system_prompt="你是 StoryForge 的中文长篇创作助手。",
        user_prompt=prompt,
    )
    return {"prompt": prompt, **result}


def _prior_chapters_text(session: Session, book_id: int, ordinal: int) -> str | None:
    """拼接本章之前所有已批准章节正文，作为续写的上文衔接，让人物与情节状态可跨章接续。"""

    if ordinal <= 1:
        return None
    prior_chapters = (
        session.query(Chapter)
        .filter(Chapter.book_id == book_id, Chapter.ordinal < ordinal)
        .order_by(Chapter.ordinal)
        .all()
    )
    blocks: list[str] = []
    for prior in prior_chapters:
        scene = (
            session.query(Scene)
            .filter(Scene.chapter_id == prior.id, Scene.status == "approved")
            .order_by(Scene.ordinal, Scene.id)
            .first()
        )
        if scene is None or not scene.content or not scene.content.strip():
            continue
        blocks.append(f"【{prior.title}】\n{scene.content.strip()}")
    return "\n\n".join(blocks) if blocks else None


def _approve_scene(session: Session, chapter: Chapter, content: str) -> Scene:
    scene = Scene(
        chapter_id=chapter.id,
        ordinal=1,
        title=f"{chapter.title} 真实 LLM 正文",
        status="approved",
        content=content,
    )
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


def _record_model_run(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    source: Mapping[str, str | None],
    generated: dict[str, object],
):
    return create_model_run(
        session,
        ModelRunCreate(
            book_id=book_run.book_id,
            scene_id=scene.id,
            provider_name=_required_env(source, "STORYFORGE_LLM_PROVIDER"),
            model_name=_required_env(source, "STORYFORGE_LLM_MODEL"),
            capability="llm",
            latency_ms=int(generated["latency_ms"]),
            token_usage=int(generated["token_usage"]),
            input_summary=str(generated["prompt"]),
            output_summary=str(generated["content"]),
            payload={
                "book_run_id": book_run.id,
                "mode": "phase9b_real_llm_smoke",
                "token_usage_source": generated["token_usage_source"],
            },
        ),
    )


def _record_scene_packet(session: Session, book_run: BookRun, scene: Scene) -> ScenePacket:
    packet = ScenePacket(
        scene_id=scene.id,
        job_run_id=None,
        status="assembled",
        packet={"book_run_id": book_run.id, "真实 LLM 冒烟": True, "证据链接": []},
        version=1,
    )
    session.add(packet)
    session.commit()
    session.refresh(packet)
    return packet


_SEVERITY_PENALTY = {"high": 15, "medium": 8, "low": 3}
_CATEGORY_DIMENSION = {
    "setting_conflict": "world_consistency",
    "timeline_conflict": "timeline_consistency",
    "relationship_conflict": "character_consistency",
    "character_consistency": "character_consistency",
    "character_voice_violation": "character_consistency",
    "style_drift": "style_consistency",
    "judge_system_failure": "system_reliability",
}
_SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _judge_and_repair_loop(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> dict[str, object]:
    """多轮 Judge→Repair 循环，直到 score ≥ 阈值或达到最大轮数。"""

    repair_patch_ids: list[int] = []
    final_issues: list[JudgeIssue] = []
    final_quality_score = 100
    final_quality_issues: list[dict[str, object]] = []

    for _round_num in range(MAX_REPAIR_ROUNDS):
        session.refresh(scene)
        issues, quality_score, quality_issues = _run_real_judge(session, book_run, scene, scene_packet)
        final_issues = issues
        final_quality_score = quality_score
        final_quality_issues = quality_issues

        if quality_score >= REPAIR_THRESHOLD or not issues:
            break

        repair_patch_id, _repaired_content = _maybe_repair(session, scene, issues, scene.content or "")
        if repair_patch_id is not None:
            repair_patch_ids.append(repair_patch_id)
        else:
            break

    judge_report_id = final_issues[0].id if final_issues else _record_summary_judge(session, scene, scene_packet, final_quality_score).id

    return {
        "judge_report_id": judge_report_id,
        "repair_patch_id": repair_patch_ids[-1] if repair_patch_ids else None,
        "repair_patch_ids": repair_patch_ids,
        "repair_rounds": len(repair_patch_ids),
        "quality_score": final_quality_score,
        "quality_issues": final_quality_issues,
    }


def _run_real_judge(
    session: Session,
    book_run: BookRun,
    scene: Scene,
    scene_packet: ScenePacket,
) -> tuple[list[JudgeIssue], int, list[dict[str, object]]]:
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

    # 传递 character_voice_constraints 给 create_judge_issues
    # 注意：create_judge_issues 内部会调用 semantic_judge_with_status，
    # 但它用的是 _load_voice_constraints 读 voice_traits，不读 forbidden_traits。
    # 我们需要直接调用 semantic_judge_with_status 并传入 character_voice_constraints。
    # 手动执行 Judge 流程（复制 create_judge_issues 的逻辑，但传入 character_voice_constraints）
    outcome = semantic_judge_with_status(payload, character_voice_constraints=character_voice_constraints)
    detected = outcome.issues or deterministic_judge_fallback(payload)
    detected = [
        *detected,
        *_detect_character_bible_violations(session, payload),
        *_detect_timeline_conflicts(session, payload),
        *_detect_style_fingerprint_drift(session, payload),
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
    return issues, quality_score, quality_issues


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
        required_facts=[],
        style_rules=style_rules,
        evidence_links=[],
    )


def _book_id_for_scene(session: Session, scene_id: int) -> int | None:
    row = session.execute(
        select(Chapter.book_id).join(Scene, Scene.chapter_id == Chapter.id).where(Scene.id == scene_id)
    ).first()
    return int(row[0]) if row is not None else None


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


def _record_summary_judge(session: Session, scene: Scene, scene_packet: ScenePacket, quality_score: int) -> JudgeIssue:
    """Judge 未发现问题时仍落一条通过记录，作为审计链的 judge_report_id。"""

    judge = JudgeIssue(
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=None,
        issue_type="phase9b_real_judge_pass",
        severity="low",
        status="resolved",
        description="真实 Judge 未发现一致性或文风问题，章节通过。",
        payload={"score": quality_score, "mode": "phase9b_real_llm_smoke"},
    )
    session.add(judge)
    session.commit()
    session.refresh(judge)
    return judge


def _pause_by_budget(
    session: Session,
    book_run_id: int,
    chapter_index: int,
    completed_chapters: list[dict[str, object]],
    tokens_used: int,
) -> None:
    apply_book_run_progress(
        session,
        book_run_id,
        BookRunProgressUpdate(
            status="paused_by_budget",
            current_chapter_index=chapter_index,
            progress={
                "completed_chapters": completed_chapters,
                "budget": {"tokens_used": tokens_used, "elapsed_time_sec": 0, "estimated_cost": 0.0},
                "pause_reason": "token_budget_exceeded",
            },
        ),
    )


def _token_usage(data: object, prompt: str, content: str) -> tuple[int, str]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        if isinstance(total, int) and total > 0:
            return total, "provider_usage"
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            return max(1, prompt_tokens + completion_tokens), "provider_usage"
    return max(1, (len(prompt) + len(content)) // 4), "estimated"


def _env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def _required_env(source: Mapping[str, str | None], name: str) -> str:
    value = _env_value(source, name)
    if not value:
        raise Phase9BRealLlmSmokePreflightError(f"缺少真实 LLM 冒烟环境变量：{name}。")
    return value


def _optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = _env_value(source, name)
    return int(value) if value else default


def _optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = _env_value(source, name)
    return float(value) if value else default


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object] = run_phase9b_real_llm_smoke,
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    """命令行入口：执行 Phase 9B 真实 LLM 冒烟并输出脱敏摘要。"""

    parser = argparse.ArgumentParser(description="运行 StoryForge Phase 9B 真实 LLM BookRun 冒烟。")
    parser.add_argument("--chapter-count", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--target-word-count", type=int, default=None)
    parser.add_argument("--chapter-word-count-min", type=int, default=600)
    parser.add_argument("--chapter-word-count-max", type=int, default=1600)
    args = parser.parse_args(argv)
    out = sys.stdout if output is None else output
    err = sys.stderr if error is None else error
    source = os.environ if env is None else env
    try:
        _assert_preflight(
            source,
            args.chapter_count,
            args.token_budget,
            args.target_word_count,
            args.chapter_word_count_min,
            args.chapter_word_count_max,
        )
    except Phase9BRealLlmSmokePreflightError as exc:
        print(str(exc), file=err)
        return 2
    if session_factory is None:
        from app.db.session import SessionLocal

        session_factory = SessionLocal
    try:
        with session_factory() as session:
            result = runner(
                session,
                chapter_count=args.chapter_count,
                token_budget=args.token_budget,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
                env=source,
            )
    except Phase9BRealLlmSmokePreflightError as exc:
        print(str(exc), file=err)
        return 2
    except Exception as exc:
        print(f"Phase 9B 真实 LLM 冒烟失败：{exc}", file=err)
        return 1
    print(json.dumps(_result_summary(result), ensure_ascii=False), file=out)
    return 0


def _result_summary(result: object) -> dict[str, object]:
    book_run = result.book_run
    markdown_artifact = result.markdown_artifact
    audit_artifact = result.audit_artifact
    return {
        "book_run_id": book_run.id,
        "status": book_run.status,
        "chapter_count": result.chapter_count,
        "tokens_used": book_run.tokens_used,
        "estimated_cost": book_run.estimated_cost,
        "markdown_artifact_id": markdown_artifact.id,
        "markdown_artifact_name": markdown_artifact.name,
        "audit_artifact_id": audit_artifact.id,
        "audit_artifact_name": audit_artifact.name,
    }


if __name__ == "__main__":
    raise SystemExit(main())
