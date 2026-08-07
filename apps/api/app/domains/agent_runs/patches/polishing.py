"""受控小说润色的确定性正文保护、候选门禁与选择策略。"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.domains.agent_runs.prose_scan import check_prose_static_quality

POLISH_RULE_VERSION = "polish-rules-v1"
POLISH_GATE_VERSION = "polish-gates-v1"

SegmentKind = Literal["body", "frontmatter", "heading", "fenced_block"]
CandidateSource = Literal["local", "online"]
DecisionStatus = Literal["accepted", "degraded", "noop", "rejected"]

_FRONTMATTER_BOUNDARY = re.compile(r"^\s*(?:---|\.\.\.)\s*$")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+\S")
_FENCE_OPEN = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_MODEL_REPLY_LINES = {
    "以下是润色后的版本：",
    "以下为润色后的版本：",
    "润色后的版本如下：",
    "润色结果：",
}
_DIALOGUE = re.compile(r"[“「].*?[”」]|\".*?\"", flags=re.S)
_PERSON_TOKENS = re.compile(r"我们|你们|他们|她们|我|你|他|她")
_SENTENCE_SPLIT = re.compile(r"[。！？!?\n]+")
_SEVERITY_WEIGHT = {"严重": 4, "高": 3, "中": 2, "低": 1}
_FILLER_MARKERS = (
    "不禁",
    "五味杂陈",
    "值得注意的是",
    "需要指出的是",
    "毋庸置疑",
    "显而易见",
    "命运的齿轮",
    "一切才刚刚开始",
)


@dataclass(frozen=True)
class PolishSegment:
    kind: SegmentKind
    text: str

    @property
    def protected(self) -> bool:
        return self.kind != "body"


@dataclass(frozen=True)
class PolishDocument:
    original: str
    segments: tuple[PolishSegment, ...]

    @property
    def polishable_parts(self) -> tuple[str, ...]:
        return tuple(segment.text for segment in self.segments if not segment.protected)


@dataclass(frozen=True)
class PolishGateConfig:
    version: str = POLISH_GATE_VERSION
    min_char_ratio: float = 0.85
    max_char_ratio: float = 1.15
    max_total_issue_increase: int = 0
    narrative_min_tokens: int = 4
    narrative_dominance_ratio: float = 0.65


@dataclass(frozen=True)
class PolishCandidate:
    source: CandidateSource
    text: str
    response_truncated: bool = False


@dataclass(frozen=True)
class PolishGateResult:
    passed: bool
    reasons: tuple[str, ...]
    metrics: Mapping[str, Any]
    gate_version: str


@dataclass(frozen=True)
class PolishDecision:
    status: DecisionStatus
    selected_source: Literal["original", "local", "online"]
    text: str
    degraded: bool
    evaluations: Mapping[str, PolishGateResult]
    rule_version: str = POLISH_RULE_VERSION


def split_polishable_markdown(text: str) -> PolishDocument:
    """把 frontmatter、首个标题和围栏块从可润色正文中完整隔离。"""

    lines = text.splitlines(keepends=True)
    segments: list[PolishSegment] = []
    body: list[str] = []

    def flush_body() -> None:
        if body:
            segments.append(PolishSegment(kind="body", text="".join(body)))
            body.clear()

    index = 0
    if lines and lines[0].strip() == "---":
        end = _find_frontmatter_end(lines)
        if end is None:
            return PolishDocument(text, (PolishSegment(kind="frontmatter", text=text),))
        segments.append(PolishSegment(kind="frontmatter", text="".join(lines[: end + 1])))
        index = end + 1

    heading_protected = False
    while index < len(lines):
        line = lines[index]
        if not heading_protected and _HEADING.match(line):
            flush_body()
            segments.append(PolishSegment(kind="heading", text=line))
            heading_protected = True
            index += 1
            continue
        fence = _FENCE_OPEN.match(line)
        if fence is not None:
            flush_body()
            end = _find_fence_end(lines, index, fence.group(1))
            if end is None:
                segments.append(PolishSegment(kind="fenced_block", text="".join(lines[index:])))
                index = len(lines)
                continue
            segments.append(PolishSegment(kind="fenced_block", text="".join(lines[index : end + 1])))
            index = end + 1
            continue
        body.append(line)
        index += 1
    flush_body()
    return PolishDocument(text, tuple(segments))


def rebuild_polishable_markdown(document: PolishDocument, polishable_parts: Sequence[str]) -> str:
    expected = len(document.polishable_parts)
    if len(polishable_parts) != expected:
        raise ValueError(f"正文片段数量不匹配：expected={expected}, actual={len(polishable_parts)}")
    parts = iter(polishable_parts)
    return "".join(segment.text if segment.protected else next(parts) for segment in document.segments)


def apply_deterministic_polish(text: str) -> str:
    document = split_polishable_markdown(text)
    cleaned = tuple(_clean_body(part) for part in document.polishable_parts)
    return rebuild_polishable_markdown(document, cleaned)


def evaluate_polish_candidate(
    original: str,
    candidate: str,
    *,
    protected_entities: Sequence[str] = (),
    character_constraints: Sequence[Mapping[str, Any]] = (),
    continuity_facts: Sequence[Any] = (),
    required_facts: Sequence[str] = (),
    response_truncated: bool = False,
    config: PolishGateConfig | None = None,
) -> PolishGateResult:
    gate = config or PolishGateConfig()
    reasons: list[str] = []
    if not candidate.strip():
        reasons.append("empty_candidate")
    if response_truncated:
        reasons.append("response_truncated")

    original_document = split_polishable_markdown(original)
    candidate_document = split_polishable_markdown(candidate)
    if _protected_signature(original_document) != _protected_signature(candidate_document):
        reasons.append("protected_structure_changed")

    original_chars = _visible_body_chars(original_document)
    candidate_chars = _visible_body_chars(candidate_document)
    char_ratio = candidate_chars / max(original_chars, 1)
    if original_chars and not gate.min_char_ratio <= char_ratio <= gate.max_char_ratio:
        reasons.append("word_count_drift")

    entity_drift = []
    for entity in _normalized_entities(protected_entities):
        if original.count(entity) != candidate.count(entity):
            entity_drift.append(entity)
            reasons.append(f"protected_entity_changed:{entity}")

    original_person = _narrative_person(original, gate)
    candidate_person = _narrative_person(candidate, gate)
    if original_person != "undetermined" and candidate_person != original_person:
        reasons.append("narrative_person_changed")

    original_issues = check_prose_static_quality(
        _body_text(original_document),
        character_constraints=character_constraints,
        continuity_facts=continuity_facts,
        required_facts=required_facts,
    )
    candidate_issues = check_prose_static_quality(
        _body_text(candidate_document),
        character_constraints=character_constraints,
        continuity_facts=continuity_facts,
        required_facts=required_facts,
    )
    if _issues_regressed(original_issues, candidate_issues, gate):
        reasons.append("prose_issue_regressed")
    if _style_metrics_regressed(_body_text(original_document), _body_text(candidate_document)):
        reasons.append("style_pattern_regressed")

    reasons = list(dict.fromkeys(reasons))
    return PolishGateResult(
        passed=not reasons,
        reasons=tuple(reasons),
        metrics={
            "original_chars": original_chars,
            "candidate_chars": candidate_chars,
            "char_ratio": round(char_ratio, 4),
            "protected_entity_drift_count": len(entity_drift),
            "original_narrative_person": original_person,
            "candidate_narrative_person": candidate_person,
            "original_issue_count": len(original_issues),
            "candidate_issue_count": len(candidate_issues),
        },
        gate_version=gate.version,
    )


def select_polish_candidate(
    original: str,
    *,
    local_candidate: PolishCandidate | None,
    online_candidate: PolishCandidate | None,
    protected_entities: Sequence[str] = (),
    character_constraints: Sequence[Mapping[str, Any]] = (),
    continuity_facts: Sequence[Any] = (),
    required_facts: Sequence[str] = (),
    config: PolishGateConfig | None = None,
) -> PolishDecision:
    candidates = tuple(candidate for candidate in (online_candidate, local_candidate) if candidate is not None)
    evaluations = {
        candidate.source: evaluate_polish_candidate(
            original,
            candidate.text,
            protected_entities=protected_entities,
            character_constraints=character_constraints,
            continuity_facts=continuity_facts,
            required_facts=required_facts,
            response_truncated=candidate.response_truncated,
            config=config,
        )
        for candidate in candidates
    }
    by_source = {candidate.source: candidate for candidate in candidates}
    online_result = evaluations.get("online")
    if online_result is not None and online_result.passed:
        online = by_source["online"]
        if online.text == original:
            return _original_decision("noop", original, evaluations)
        return PolishDecision("accepted", "online", online.text, False, evaluations)
    local_result = evaluations.get("local")
    if local_result is not None and local_result.passed:
        local = by_source["local"]
        if local.text == original:
            return _original_decision("noop", original, evaluations)
        status: DecisionStatus = "degraded" if online_candidate is not None else "accepted"
        return PolishDecision(status, "local", local.text, online_candidate is not None, evaluations)
    return _original_decision("rejected", original, evaluations)


def _original_decision(
    status: Literal["noop", "rejected"], original: str, evaluations: Mapping[str, PolishGateResult]
) -> PolishDecision:
    return PolishDecision(status, "original", original, False, evaluations)


def _find_frontmatter_end(lines: Sequence[str]) -> int | None:
    for index in range(1, len(lines)):
        if _FRONTMATTER_BOUNDARY.match(lines[index]):
            return index
    return None


def _find_fence_end(lines: Sequence[str], start: int, opener: str) -> int | None:
    marker = opener[0]
    minimum = len(opener)
    closing = re.compile(rf"^\s{{0,3}}{re.escape(marker)}{{{minimum},}}\s*$")
    for index in range(start + 1, len(lines)):
        if closing.match(lines[index]):
            return index
    return None


def _clean_body(text: str) -> str:
    lines = text.splitlines(keepends=True)
    first_content = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_content is not None and lines[first_content].strip() in _MODEL_REPLY_LINES:
        del lines[first_content]
        if first_content < len(lines) and not lines[first_content].strip():
            del lines[first_content]
    cleaned = "".join(lines)
    cleaned = re.sub(r"，{2,}", "，", cleaned)
    cleaned = re.sub(r"。{2,}", "。", cleaned)
    cleaned = re.sub(r"！{2,}", "！", cleaned)
    cleaned = re.sub(r"？{2,}", "？", cleaned)
    cleaned = re.sub(r"(?<!\.)\.{3}(?!\.)", "……", cleaned)
    return cleaned


def _protected_signature(document: PolishDocument) -> tuple[tuple[str, str], ...]:
    return tuple((segment.kind, segment.text) for segment in document.segments if segment.protected)


def _body_text(document: PolishDocument) -> str:
    return "".join(document.polishable_parts)


def _visible_body_chars(document: PolishDocument) -> int:
    return len(re.sub(r"\s+", "", _body_text(document)))


def _normalized_entities(entities: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(entity.strip() for entity in entities if isinstance(entity, str) and entity.strip()))


def _narrative_person(text: str, config: PolishGateConfig) -> str:
    narrative = _DIALOGUE.sub("", _body_text(split_polishable_markdown(text)))
    counts = Counter(_PERSON_TOKENS.findall(narrative))
    first = counts["我"] + counts["我们"]
    second = counts["你"] + counts["你们"]
    third = counts["他"] + counts["她"] + counts["他们"] + counts["她们"]
    total = first + second + third
    if total < config.narrative_min_tokens:
        return "undetermined"
    groups = {"first": first, "second": second, "third": third}
    person, count = max(groups.items(), key=lambda item: item[1])
    return person if count / total >= config.narrative_dominance_ratio else "mixed"


def _issues_regressed(original: Sequence[Any], candidate: Sequence[Any], config: PolishGateConfig) -> bool:
    original_counts = Counter((issue.dimension, issue.severity) for issue in original)
    candidate_counts = Counter((issue.dimension, issue.severity) for issue in candidate)
    original_serious = sum(count for (dimension, severity), count in original_counts.items() if _SEVERITY_WEIGHT.get(severity, 0) >= 3)
    candidate_serious = sum(count for (dimension, severity), count in candidate_counts.items() if _SEVERITY_WEIGHT.get(severity, 0) >= 3)
    if candidate_serious > original_serious:
        return True
    if len(candidate) > len(original) + config.max_total_issue_increase:
        return True
    return any(
        count > original_counts[(dimension, severity)] and _SEVERITY_WEIGHT.get(severity, 0) >= 2
        for (dimension, severity), count in candidate_counts.items()
    )


def _style_metrics_regressed(original: str, candidate: str) -> bool:
    original_fillers = sum(original.count(marker) for marker in _FILLER_MARKERS)
    candidate_fillers = sum(candidate.count(marker) for marker in _FILLER_MARKERS)
    if candidate_fillers > original_fillers:
        return True
    original_starters = _repeated_sentence_starters(original)
    candidate_starters = _repeated_sentence_starters(candidate)
    return candidate_starters > max(original_starters, 2)


def _repeated_sentence_starters(text: str) -> int:
    sentences = [sentence.strip() for sentence in _SENTENCE_SPLIT.split(text) if sentence.strip()]
    starters = Counter(sentence[:2] for sentence in sentences if len(sentence) >= 2)
    return sum(count - 1 for count in starters.values() if count >= 3)
