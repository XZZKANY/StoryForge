from __future__ import annotations

import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx
from prometheus_client import Counter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.common.logging_config import get_logger
from app.domains.books.models import Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.story_memory.models import MemoryAtomRecord


class JudgeInputError(InputError):
    """评审请求无法定位场景或上下文包时抛出。"""


_judge_llm_errors_total = Counter(
    "judge_llm_errors_total",
    "Total semantic judge LLM errors (network, timeout, malformed response)",
)


@dataclass(frozen=True)
class DetectedIssue:
    """服务内部的确定性命中结果，写库前先保持字段完整。"""

    category: str
    severity: str
    span_start: int
    span_end: int
    summary: str
    recommended_repair_mode: str
    expected_text: str
    replacement_text: str
    matched_text: str
    metadata: dict[str, object] | None = None


STYLE_DRIFT_PHRASES = ("作者直接解释", "设定说明", "旁白解释", "直接说明设定", "作者在这里解释")
STYLE_FINGERPRINT_DRIFT_PHRASES = (
    *STYLE_DRIFT_PHRASES,
    "这说明",
    "意味着",
    "读者立刻明白",
    "宏大轮盘",
)
STYLE_RESTRAINT_MARKERS = ("克制", "沉默", "低声", "按住", "没有解释", "只把")
STYLE_FINGERPRINT_THRESHOLD = 0.62
JudgeProvider = Callable[[JudgeIssueCreate], Sequence[dict[str, object] | DetectedIssue]]


@dataclass(frozen=True)
class StyleFingerprint:
    """用少量可解释特征描述已批准章节的文风基线。"""

    average_sentence_length: float
    exposition_density: float
    restraint_density: float
    dialogue_ratio: float
    sentence_count: int

    def as_payload(self) -> dict[str, float | int]:
        return {
            "average_sentence_length": self.average_sentence_length,
            "exposition_density": self.exposition_density,
            "restraint_density": self.restraint_density,
            "dialogue_ratio": self.dialogue_ratio,
            "sentence_count": self.sentence_count,
        }


def create_judge_issues(session: Session, payload: JudgeIssueCreate) -> list[JudgeIssue]:
    """优先使用 LLM 语义评审，缺少配置时回退到确定性规则。"""

    _validate_scene_packet(session, payload.scene_id, payload.scene_packet_id)
    voice_constraints = _load_voice_constraints(session, payload.scene_id)
    detected = semantic_judge(payload, character_voice_constraints=voice_constraints) or deterministic_judge_fallback(payload)
    detected = [
        *detected,
        *_detect_character_bible_violations(session, payload),
        *_detect_timeline_conflicts(session, payload),
        *_detect_style_fingerprint_drift(session, payload),
    ]
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


def deterministic_judge_fallback(payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """无模型配置或模型未返回可用结构时，提供可复现的本地备用评审。"""

    return [
        *_detect_setting_conflicts(payload.content, payload.required_facts),
        *_detect_style_drift(payload.content, payload.style_rules),
    ]


def _detect_character_bible_violations(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """按 Character Bible 禁止特质生成角色一致性问题单。"""

    book_id = _book_id_for_scene(session, payload.scene_id)
    if book_id is None:
        return []
    entries = session.scalars(
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.book_id == book_id)
        .order_by(CharacterBibleEntry.canonical_name, CharacterBibleEntry.id)
    ).all()
    issues: list[DetectedIssue] = []
    for entry in entries:
        replacement_map = _forbidden_replacement_map(entry.forbidden_traits)
        for forbidden_trait in _forbidden_trait_phrases(entry.forbidden_traits):
            if forbidden_trait not in payload.content:
                continue
            start = payload.content.index(forbidden_trait)
            replacement = replacement_map.get(forbidden_trait, f"避免{forbidden_trait}")
            issues.append(
                DetectedIssue(
                    category="character_consistency",
                    severity="high",
                    span_start=start,
                    span_end=start + len(forbidden_trait),
                    summary=f"正文违反角色“{entry.canonical_name}”的禁止特质“{forbidden_trait}”。",
                    recommended_repair_mode="replace_span",
                    expected_text=f"不得呈现：{forbidden_trait}",
                    replacement_text=replacement,
                    matched_text=forbidden_trait,
                    metadata={
                        "consistency_dimensions": {
                            "character_consistency": "fail",
                            "world_consistency": "pass",
                        },
                        "violation": {
                            "type": "forbidden_trait",
                            "canonical_name": entry.canonical_name,
                            "forbidden_trait": forbidden_trait,
                            "replacement_text": replacement,
                        },
                        "forbidden_trait": forbidden_trait,
                        "character_bible_entry_id": entry.id,
                    },
                )
            )
    return issues


def _load_voice_constraints(session: Session, scene_id: int) -> list[dict]:
    """读取作品下的角色声音约束，仅保留声明了 voice_traits 的条目。"""

    book_id = _book_id_for_scene(session, scene_id)
    if book_id is None:
        return []
    entries = session.scalars(
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.book_id == book_id)
        .order_by(CharacterBibleEntry.canonical_name, CharacterBibleEntry.id)
    ).all()
    return [
        {"name": entry.canonical_name, "voice_traits": entry.voice_traits}
        for entry in entries
        if entry.voice_traits
    ]


def _detect_timeline_conflicts(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """基于当前有效 Story Memory 检测最小时间线矛盾。"""

    scope = _scene_scope_for_judge(session, payload.scene_id)
    if scope is None:
        return []
    book_id, chapter_ordinal = scope
    records = session.scalars(
        select(MemoryAtomRecord)
        .where(
            MemoryAtomRecord.book_id == book_id,
            MemoryAtomRecord.entity_type == "character",
            MemoryAtomRecord.fact_type.in_(("status", "location")),
            MemoryAtomRecord.valid_from_chapter <= chapter_ordinal,
            (MemoryAtomRecord.valid_to_chapter.is_(None) | (MemoryAtomRecord.valid_to_chapter >= chapter_ordinal)),
        )
        .order_by(MemoryAtomRecord.entity_id, MemoryAtomRecord.fact_type, MemoryAtomRecord.id)
    ).all()
    issues: list[DetectedIssue] = []
    for record in records:
        if record.fact_type == "status":
            death_issue = _dead_character_issue(payload.content, record)
            if death_issue is not None:
                issues.append(death_issue)
        if record.fact_type == "location":
            location_issue = _same_time_location_issue(payload.content, record)
            if location_issue is not None:
                issues.append(location_issue)
    return issues


def _detect_style_fingerprint_drift(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """用已批准章节正文建立文风基线，并对后续章节明显偏离扣分。"""

    sources = _approved_style_sources(session, payload.scene_id)
    if not sources:
        return []
    source_scene_ids = [scene_id for scene_id, _content in sources]
    baseline_text = "\n".join(content for _scene_id, content in sources)
    baseline = _style_fingerprint(baseline_text)
    current = _style_fingerprint(payload.content)
    style_score = _style_similarity_score(baseline, current)
    if style_score >= STYLE_FINGERPRINT_THRESHOLD:
        return []
    matched_text = _first_style_drift_phrase(payload.content)
    span_start = payload.content.index(matched_text) if matched_text in payload.content else 0
    span_end = span_start + len(matched_text)
    return [
        DetectedIssue(
            category="style_drift",
            severity="medium",
            span_start=span_start,
            span_end=span_end,
            summary=f"正文文风与已批准章节指纹偏离，style_score={style_score:.2f} 低于阈值。",
            recommended_repair_mode="replace_span",
            expected_text="延续已批准章节的文风指纹",
            replacement_text="延续已批准章节的克制描写",
            matched_text=matched_text,
            metadata={
                "style_dimension": "fingerprint_drift",
                "style_score": style_score,
                "style_baseline_score": 1.0,
                "style_threshold": STYLE_FINGERPRINT_THRESHOLD,
                "style_fingerprint": {
                    "baseline": baseline.as_payload(),
                    "current": current.as_payload(),
                    "source_scene_ids": source_scene_ids,
                },
                "violation": {
                    "type": "style_fingerprint_drift",
                    "source_scene_ids": source_scene_ids,
                },
            },
        )
    ]


_JUDGE_SYSTEM_PROMPT = """\
你是 StoryForge 的结构化一致性评审员。仅返回 JSON 数组，不要解释。

## 检测类别与严重性

| category | 触发条件 | severity |
|---|---|---|
| setting_conflict | 正文与必含事实直接矛盾（地点、物品、伤情等） | high |
| timeline_conflict | 已死亡角色出场，或同一时刻角色出现在两处 | high |
| relationship_conflict | 角色关系与已知事实矛盾（敌友、亲属、从属） | medium |
| style_drift | 出现解释性旁白、作者直接说明，破坏叙事克制感 | medium |
| character_voice_violation | 角色对白/行为违反其声音约束（语气、句式、禁忌词） | medium |

severity 只能是 low / medium / high。

## 输出格式（JSON 数组，每项必须包含以下字段）

```json
[
  {
    "category": "setting_conflict",
    "severity": "high",
    "span_start": 12,
    "span_end": 18,
    "matched_text": "左臂完好无损",
    "expected_text": "左臂受伤",
    "replacement_text": "左臂仍然受伤",
    "summary": "正文与必含事实"左臂受伤"矛盾。"
  }
]
```

span_start / span_end 是正文中的字符偏移量（0-based）。无问题时返回空数组 []。\
"""

_JUDGE_FEW_SHOT = """\
## 示例

### 示例 1 — setting_conflict
正文：「她举起右臂，剑光一闪。」
必含事实：["右臂受伤"]
输出：[{"category":"setting_conflict","severity":"high","span_start":3,"span_end":5,"matched_text":"右臂","expected_text":"右臂受伤","replacement_text":"左臂","summary":"正文与必含事实"右臂受伤"矛盾，角色不应能举起右臂。"}]

### 示例 2 — character_voice_violation
正文：「林寒长篇大论地解释了自己的动机，语气热切。」
角色声音约束：[{"name":"林寒","voice_traits":{"语气":"克制","句式":"短促"}}]
输出：[{"category":"character_voice_violation","severity":"medium","span_start":2,"span_end":18,"matched_text":"长篇大论地解释了自己的动机，语气热切","expected_text":"克制、短促的表达","replacement_text":"林寒只说了一个字。","summary":"林寒的对白违反声音约束：应克制、短促，不应长篇解释动机。"}]

### 示例 3 — 无问题
正文：「她沉默地走过长廊。」
必含事实：[]
输出：[]\
"""


def semantic_judge(
    payload: JudgeIssueCreate,
    *,
    provider: JudgeProvider | None = None,
    character_voice_constraints: list[dict] | None = None,
) -> list[DetectedIssue]:
    """调用 OpenAI 兼容模型执行语义一致性评审。"""

    if provider is not None:
        return _issues_from_provider_items(provider(payload), payload.content)

    api_key = os.getenv("STORYFORGE_JUDGE_LLM_API_KEY") or os.getenv("STORYFORGE_LLM_API_KEY")
    if not api_key:
        return []
    base_url = os.getenv("STORYFORGE_JUDGE_LLM_BASE_URL") or os.getenv("STORYFORGE_LLM_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("STORYFORGE_JUDGE_LLM_MODEL") or os.getenv("STORYFORGE_LLM_MODEL", "gpt-4o-mini")

    voice_section = f"\n角色声音约束：{character_voice_constraints}" if character_voice_constraints else ""
    user_prompt = (
        f"{_JUDGE_FEW_SHOT}\n\n"
        f"## 待评审正文\n{payload.content}\n"
        f"必含事实：{payload.required_facts}\n"
        f"风格规则：{payload.style_rules}"
        f"{voice_section}"
    )
    request_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0,
    }
    log = get_logger(__name__)
    try:
        with httpx.Client(timeout=float(os.getenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS", "30"))) as client:
            response = client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                json=request_payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            data = response.json()
        raw_content = data["choices"][0]["message"]["content"]
        decoded = json.loads(raw_content)
    except Exception as exc:
        log.warning("semantic_judge_failed", error=str(exc), model=model)
        _judge_llm_errors_total.inc()
        return []
    if not isinstance(decoded, list):
        log.warning("semantic_judge_invalid_response", raw=str(raw_content)[:200])
        return []
    valid_items = [item for item in decoded if isinstance(item, dict) and "category" in item]
    if len(valid_items) < len(decoded):
        log.warning("semantic_judge_filtered_items", dropped=len(decoded) - len(valid_items))
    return _issues_from_provider_items(valid_items, payload.content)


def _issues_from_provider_items(items: Sequence[dict[str, object] | DetectedIssue], content: str) -> list[DetectedIssue]:
    """规整 provider 返回值，让远程模型和本地测试替身走同一条解析路径。"""

    issues: list[DetectedIssue] = []
    for item in items:
        if isinstance(item, DetectedIssue):
            issues.append(item)
        elif isinstance(item, dict):
            issues.append(_issue_from_llm_item(item, content))
    return issues


def _book_id_for_scene(session: Session, scene_id: int) -> int | None:
    """通过场景找到作品 id，避免 Judge 请求重复传 book_id。"""

    scope = _scene_scope_for_judge(session, scene_id)
    return scope[0] if scope is not None else None


def _scene_scope_for_judge(session: Session, scene_id: int) -> tuple[int, int] | None:
    """返回 Judge 所需的作品 id 和章节序号。"""

    row = session.execute(
        select(Chapter.book_id)
        .add_columns(Chapter.ordinal)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(Scene.id == scene_id)
    ).first()
    if row is None:
        return None
    return int(row[0]), int(row[1])


def _approved_style_sources(session: Session, scene_id: int) -> list[tuple[int, str]]:
    """读取同作品当前章节之前的已批准正文，作为 Style Guard 基线。"""

    current = session.execute(
        select(Chapter.book_id, Chapter.ordinal)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(Scene.id == scene_id)
    ).first()
    if current is None:
        return []
    rows = session.execute(
        select(Scene.id, Scene.content)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == int(current[0]),
            Chapter.ordinal < int(current[1]),
            Chapter.status == "approved",
            Scene.content.is_not(None),
            Scene.id != scene_id,
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()
    return [(int(scene_id), str(content).strip()) for scene_id, content in rows if str(content).strip()]


def compute_book_style_baseline(session: Session, book_id: int) -> dict[str, float | int] | None:
    """用作品下全部已批准章节正文算出 StyleFingerprint 基线，供生成前前馈对齐。

    无已批准章节时返回 None，交由调用方省略注入，绝不伪造空指纹。
    """

    rows = session.execute(
        select(Scene.content)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book_id,
            Chapter.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()
    contents = [str(content).strip() for (content,) in rows if str(content).strip()]
    if not contents:
        return None
    return _style_fingerprint("\n".join(contents)).as_payload()


def _style_fingerprint(content: str) -> StyleFingerprint:
    """提取可解释的轻量文风特征，避免测试依赖外部 NLP 服务。"""

    sentences = _style_sentences(content)
    sentence_count = len(sentences)
    total_chars = sum(len(sentence) for sentence in sentences) or 1
    average_sentence_length = round(total_chars / max(sentence_count, 1), 3)
    exposition_density = round(_marker_count(content, STYLE_FINGERPRINT_DRIFT_PHRASES) / max(sentence_count, 1), 3)
    restraint_density = round(_marker_count(content, STYLE_RESTRAINT_MARKERS) / max(sentence_count, 1), 3)
    dialogue_ratio = round((content.count("“") + content.count("”")) / max(len(content), 1), 3)
    return StyleFingerprint(
        average_sentence_length=average_sentence_length,
        exposition_density=exposition_density,
        restraint_density=restraint_density,
        dialogue_ratio=dialogue_ratio,
        sentence_count=sentence_count,
    )


def _style_sentences(content: str) -> list[str]:
    separators = "。！？!?\n\r"
    sentences: list[str] = []
    start = 0
    for index, char in enumerate(content):
        if char not in separators:
            continue
        sentence = content[start:index].strip()
        if sentence:
            sentences.append(sentence)
        start = index + 1
    tail = content[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences or [content.strip()] if content.strip() else []


def _marker_count(content: str, markers: Sequence[str]) -> int:
    return sum(content.count(marker) for marker in markers)


def _style_similarity_score(baseline: StyleFingerprint, current: StyleFingerprint) -> float:
    """把当前文风与基线压缩为 0-1 分数，分数越低表示偏离越大。"""

    sentence_delta = _relative_delta(baseline.average_sentence_length, current.average_sentence_length)
    exposition_delta = min(abs(current.exposition_density - baseline.exposition_density), 1.0)
    restraint_delta = min(abs(current.restraint_density - baseline.restraint_density), 1.0)
    dialogue_delta = min(abs(current.dialogue_ratio - baseline.dialogue_ratio) * 8, 1.0)
    score = 1.0 - (0.35 * sentence_delta) - (0.35 * exposition_delta) - (0.2 * restraint_delta) - (0.1 * dialogue_delta)
    return round(max(0.0, min(1.0, score)), 3)


def _relative_delta(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right), 1.0)
    return min(abs(left - right) / denominator, 1.0)


def _first_style_drift_phrase(content: str) -> str:
    for phrase in STYLE_FINGERPRINT_DRIFT_PHRASES:
        if phrase in content:
            return phrase
    sentences = _style_sentences(content)
    return sentences[0] if sentences else content[:1]


def _dead_character_issue(content: str, record: MemoryAtomRecord) -> DetectedIssue | None:
    """角色已死亡但正文仍让其出场时生成时间线冲突。"""

    if record.entity_id not in content or not _contains_death_state(record.value):
        return None
    start = content.index(record.entity_id)
    return DetectedIssue(
        category="timeline_conflict",
        severity="high",
        span_start=start,
        span_end=start + len(record.entity_id),
        summary=f"角色“{record.entity_id}”已死亡，不能在当前章节继续出场。",
        recommended_repair_mode="replace_span",
        expected_text=record.value,
        replacement_text=f"删除{record.entity_id}的出场",
        matched_text=record.entity_id,
        metadata={
            "violation": {
                "type": "dead_character_appears",
                "entity_id": record.entity_id,
            },
            "timeline_fact": _timeline_fact_payload(record),
        },
    )


def _same_time_location_issue(content: str, record: MemoryAtomRecord) -> DetectedIssue | None:
    """同一时间角色出现在不同地点时生成时间线冲突。"""

    if record.entity_id not in content:
        return None
    expected = _parse_timeline_location(record.value)
    if expected is None:
        return None
    time_marker, expected_location = expected
    if time_marker not in content:
        return None
    observed_location = _observed_location_after_character(content, record.entity_id)
    if observed_location is None or observed_location == expected_location:
        return None
    start = content.index(observed_location)
    return DetectedIssue(
        category="timeline_conflict",
        severity="high",
        span_start=start,
        span_end=start + len(observed_location),
        summary=f"角色“{record.entity_id}”在“{time_marker}”应位于“{expected_location}”，不能同时出现在“{observed_location}”。",
        recommended_repair_mode="replace_span",
        expected_text=expected_location,
        replacement_text=expected_location,
        matched_text=observed_location,
        metadata={
            "violation": {
                "type": "same_time_different_location",
                "entity_id": record.entity_id,
                "time": time_marker,
                "expected_location": expected_location,
                "observed_location": observed_location,
            },
            "timeline_fact": _timeline_fact_payload(record),
        },
    )


def _contains_death_state(value: str) -> bool:
    return any(marker in value for marker in ("已死亡", "死亡", "身亡", "去世", "死去"))


def _timeline_fact_payload(record: MemoryAtomRecord) -> dict[str, object]:
    return {
        "memory_atom_id": record.id,
        "fact_type": record.fact_type,
        "value": record.value,
        "source_ref": record.source_ref,
    }


def _parse_timeline_location(value: str) -> tuple[str, str] | None:
    """解析“时间：午夜；地点：雾港”这类最小位置事实。"""

    time_marker = _extract_labeled_value(value, "时间")
    location = _extract_labeled_value(value, "地点")
    if time_marker and location:
        return time_marker, location
    return None


def _extract_labeled_value(value: str, label: str) -> str | None:
    for separator in ("：", ":"):
        marker = f"{label}{separator}"
        start = value.find(marker)
        if start < 0:
            continue
        value_start = start + len(marker)
        value_end = value_start
        while value_end < len(value) and value[value_end] not in "；;，,。.\n\r\t ":
            value_end += 1
        extracted = value[value_start:value_end].strip()
        if extracted:
            return extracted
    return None


def _observed_location_after_character(content: str, entity_id: str) -> str | None:
    marker = f"{entity_id}在"
    start = content.find(marker)
    if start < 0:
        return None
    value_start = start + len(marker)
    value_end = value_start
    while value_end < len(content) and content[value_end] not in "，,。.;；\n\r\t ":
        value_end += 1
    observed = content[value_start:value_end].strip()
    for verb in ("点亮", "走进", "走向", "寻找", "举起", "向"):
        if verb in observed:
            observed = observed.split(verb, 1)[0].strip()
    return observed or None


def _forbidden_trait_phrases(value: object) -> list[str]:
    """从 forbidden_traits JSON 中递归抽取禁止短语。"""

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        phrases: list[str] = []
        for item in value:
            phrases.extend(_forbidden_trait_phrases(item))
        return _unique_strings(phrases)
    if isinstance(value, dict):
        phrases: list[str] = []
        for key, item in value.items():
            if str(key) in {"替换", "replacements", "replacement_text"}:
                continue
            phrases.extend(_forbidden_trait_phrases(item))
        return _unique_strings(phrases)
    return []


def _forbidden_replacement_map(value: object) -> dict[str, str]:
    """读取 forbidden_traits 中显式声明的替换文本。"""

    if not isinstance(value, dict):
        return {}
    raw_map = value.get("替换") or value.get("replacements")
    if not isinstance(raw_map, dict):
        return {}
    return {str(key): str(replacement) for key, replacement in raw_map.items() if str(key).strip()}


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            unique.append(value)
    return unique


def _detect_setting_conflicts(content: str, required_facts: list[str]) -> list[DetectedIssue]:
    """识别必含事实的直接矛盾；未矛盾时再检查事实缺失。"""

    issues: list[DetectedIssue] = []
    for fact in required_facts:
        normalized_fact = fact.strip()
        if not normalized_fact:
            continue
        conflict = _find_conflict_phrase(content, normalized_fact)
        if conflict is not None:
            phrase, replacement = conflict
            start = content.index(phrase)
            issues.append(
                DetectedIssue(
                    category="setting_conflict",
                    severity="high",
                    span_start=start,
                    span_end=start + len(phrase),
                    summary=f"正文与必含事实“{normalized_fact}”冲突。",
                    recommended_repair_mode="replace_span",
                    expected_text=normalized_fact,
                    replacement_text=replacement,
                    matched_text=phrase,
                )
            )
        elif normalized_fact not in content:
            issues.append(_missing_fact_issue(content, normalized_fact))
    return issues


def _find_conflict_phrase(content: str, fact: str) -> tuple[str, str] | None:
    """按事实短语生成少量明确反义模板，确保定位结果可复现。"""

    replacements = {
        "左臂受伤": (("左臂完好无损", "左臂仍然受伤"), ("左臂没有受伤", "左臂仍然受伤")),
        "右臂受伤": (("右臂完好无损", "右臂仍然受伤"), ("右臂没有受伤", "右臂仍然受伤")),
    }
    for phrase, replacement in replacements.get(fact, ()):  # 项目早期先覆盖确定性高的硬约束。
        if phrase in content:
            return phrase, replacement
    field_conflict = _find_field_conflict(content, fact)
    if field_conflict is not None:
        return field_conflict
    if fact.endswith("受伤"):
        subject = fact[: -len("受伤")]
        for suffix in ("完好无损", "没有受伤", "毫发无伤"):
            phrase = f"{subject}{suffix}"
            if subject and phrase in content:
                return phrase, f"{subject}仍然受伤"
    return None


def _find_field_conflict(content: str, fact: str) -> tuple[str, str] | None:
    """识别“字段：值”类事实在正文中的不同取值。"""

    separator = "：" if "：" in fact else ":"
    if separator not in fact:
        return None
    field, expected = [part.strip() for part in fact.split(separator, 1)]
    if not field or not expected:
        return None
    marker = f"{field}{separator}"
    start = content.find(marker)
    if start < 0:
        return None
    value_start = start + len(marker)
    value_end = value_start
    while value_end < len(content) and content[value_end] not in "，。；;,. \n\r\t":
        value_end += 1
    observed = content[value_start:value_end].strip()
    if observed and observed != expected:
        return f"{marker}{observed}", f"{marker}{expected}"
    return None


def _issue_from_llm_item(item: dict, content: str) -> DetectedIssue:
    """把模型 JSON 条目规整为内部问题对象，防止越界位置污染响应。"""

    span_start = max(0, min(int(item.get("span_start", 0)), len(content)))
    span_end = max(span_start, min(int(item.get("span_end", span_start)), len(content)))
    category = str(item.get("category", "setting_conflict"))
    severity = str(item.get("severity", "medium"))
    matched_text = str(item.get("matched_text") or content[span_start:span_end])
    expected_text = str(item.get("expected_text", ""))
    return DetectedIssue(
        category=category,
        severity=severity if severity in {"low", "medium", "high"} else "medium",
        span_start=span_start,
        span_end=span_end,
        summary=str(item.get("summary") or f"模型发现 {category}。"),
        recommended_repair_mode="replace_span",
        expected_text=expected_text,
        replacement_text=str(item.get("replacement_text") or expected_text),
        matched_text=matched_text,
    )


def _missing_fact_issue(content: str, fact: str) -> DetectedIssue:
    """必含事实缺失时锚定开头插入点，避免改写整章正文。"""

    span_end = 0 if not content else min(1, len(content))
    return DetectedIssue(
        category="setting_conflict",
        severity="medium",
        span_start=0,
        span_end=span_end,
        summary=f"正文缺少必含事实“{fact}”。",
        recommended_repair_mode="replace_span",
        expected_text=fact,
        replacement_text=(fact if span_end == 0 else f"{content[:span_end]}{fact}"),
        matched_text=content[:span_end],
    )


def _detect_style_drift(content: str, style_rules: list[str]) -> list[DetectedIssue]:
    """当克制文风下出现解释性短语时，生成文风漂移问题。"""

    if not any("克制" in rule for rule in style_rules):
        return []
    issues: list[DetectedIssue] = []
    for phrase in STYLE_DRIFT_PHRASES:
        if phrase not in content:
            continue
        start = content.index(phrase)
        issues.append(
            DetectedIssue(
                category="style_drift",
                severity="medium",
                span_start=start,
                span_end=start + len(phrase),
                summary=f"克制文风下不应出现“{phrase}”这类解释性短语。",
                recommended_repair_mode="replace_span",
                expected_text="克制",
                replacement_text="她把解释压回沉默里",
                matched_text=phrase,
            )
        )
    return issues
