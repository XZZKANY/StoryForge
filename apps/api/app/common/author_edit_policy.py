"""Explicit, source-bound edit permissions shared by writers and postprocessors.

No project, environment, domain or model access belongs in this value layer.
Free-form requirements remain writer input; only explicit recognised controls
become deterministic permissions, never prose copied into an anchor/context.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field

POLICY_VERSION = "author-edit-v1"
_ANCHOR = re.compile(r"<<<(?:ANCHOR|FILE|CONTEXT)\b.*?(?:ANCHOR|FILE|CONTEXT)>>>", re.S)
_CHANGE = re.compile(r"统一|替换|换成|换为|改成|改为|转换|调整|改用|修改|更改|改")
_NEGATION = re.compile(r"(?:不要|不用|不必|别|禁止|不得|不准|不许|请勿|勿|不允许|不可以|不可|不|避免)[一-鿿]{0,6}$")
_QUOTE_END = {"“": "”", "「": "」", "『": "』", "‘": "’", '"': '"', "'": "'"}
_KEEP_PREFIX = re.compile(r"(?:(?:逐字|原样)\s*)?(?:保留|保持)\s*$")
_KEEP_SUFFIX = re.compile(r"\s*(?:逐字(?:不变|保留|不动)|原样(?:不变|保留)?|不动)")
_ADOPT_PREFIX = re.compile(
    r"^\s*(?:请|本次(?:请|要求)|我的要求是|作者要求是)?(?:执行|遵循|采用|应用|按照|按)\s*(?:(?:下面|以下|这条|这个|此)(?:的)?)?"
    r"\s*(?:(?:作者)?(?:要求|指令|规则|约定|命令))?\s*(?:执行|处理|修改|修订)?\s*[:：]?\s*$"
)
_ADOPT_SUFFIX = re.compile(
    r"\s*[,，:：]?\s*(?:(?:这|此)(?:条|句)?(?:才)?是(?:我|作者)的(?:明确|实际|真实)?(?:要求|指令)"
    r"|请(?:照做|执行|遵循|采用)|(?:当作|作为)(?:我的|作者的)(?:要求|指令)执行)\s*(?:[。；;\n]|$)"
)
_CONTROL_OPERANDS = frozenset(
    ("第一人称", "第二人称", "第三人称", "引号", "直引号", "中文引号", "重复问号", "重复感叹号")
)


def _control_is_negated(text: str, offset: int) -> bool:
    prefix = re.sub(r"[\s“”「」『』‘’\"']", "", text[:offset])
    return bool(_NEGATION.search(prefix))


def _quoted_material(text: str) -> Iterator[tuple[int, int, str, str, bool]]:
    """Yield complete top-level quoted/code regions; an unclosed region consumes the tail."""
    index = 0
    while index < len(text):
        start = index
        char = text[index]
        if char == "`" or text.startswith("~~~", index):
            end = index + 1
            while end < len(text) and text[end] == char:
                end += 1
            marker = text[index:end]
            close = re.search(rf"(?<!{re.escape(char)}){re.escape(marker)}(?!{re.escape(char)})", text[end:])
            index = end + close.end() if close else len(text)
            yield start, index, marker, marker, close is not None
            continue
        if char not in _QUOTE_END or (
            char == "'" and index and text[index - 1].isascii() and text[index - 1].isalnum()
        ):
            index += 1
            continue
        closing = _QUOTE_END[char]
        stack = [closing]
        index += 1
        while index < len(text) and stack:
            current = text[index]
            # Apostrophes inside English words do not close surrounding sample
            # quotes (for example 'I'm ...' or ‘Don’t ...’).
            if (
                current in ("'", "’")
                and index + 1 < len(text)
                and text[index - 1].isascii()
                and text[index - 1].isalnum()
                and text[index + 1].isascii()
                and text[index + 1].isalnum()
            ):
                index += 1
                continue
            if current == "\\" and index + 1 < len(text):
                index += 2
                continue
            if current == stack[-1]:
                stack.pop()
            elif current in _QUOTE_END and not (
                current == "'" and text[index - 1].isascii() and text[index - 1].isalnum()
            ):
                stack.append(_QUOTE_END[current])
            index += 1
        yield start, index, char, closing, not stack


def _author_control_projection(text: str, depth: int = 0) -> tuple[str, tuple[str, ...]]:
    """Keep original instructions for the writer; extract controls outside material quotes.

    Explicitly adopted quoted rules and quoted operand names remain usable. Literal
    protection consumes the quoted payload as data, never as another edit command.
    Offsets stay stable while quoted material is blanked, including multiline text.
    """
    if depth >= 16:
        return " " * len(text), ()
    projected = list(text)
    literals: list[str] = []
    for start, end, marker, closing, closed in _quoted_material(text):
        raw = text[start:end]
        body = raw[len(marker) : -len(closing)] if closed else raw[len(marker) :]
        prefix = "".join(projected[:start])
        suffix = text[end:]
        keep = _KEEP_PREFIX.search(prefix)
        literal_keep = bool(
            closed
            and body
            and keep
            and not _control_is_negated(prefix, keep.start())
            and (keep.group().startswith(("逐字", "原样")) or _KEEP_SUFFIX.match(suffix))
        )
        if literal_keep:
            literals.append(body)
        adoption_prefix = re.split(r"[。；;\n]", prefix.rstrip())[-1]
        adoption = _ADOPT_PREFIX.fullmatch(adoption_prefix)
        adopted = bool(closed and not literal_keep and (adoption or _ADOPT_SUFFIX.match(suffix)))
        if adopted or (closed and body in _CONTROL_OPERANDS and not literal_keep):
            inner, nested = _author_control_projection(body, depth + 1)
            projected[start:end] = " " * len(marker) + inner + " " * len(closing)
            literals.extend(nested)
        else:
            projected[start:end] = ["\n" if char == "\n" else " " for char in raw]
    return "".join(projected), tuple(literals)


def _quote_change_control(clause: str) -> bool | None:
    quotes = list(re.finditer("引号", clause))
    for change in _CHANGE.finditer(clause):
        for quote in quotes:
            left, right = (
                (change.end(), quote.start()) if change.start() < quote.start() else (quote.end(), change.start())
            )
            bridge = clause[left:right]
            if len(bridge) <= 12 and not re.search(r"并|但|同时|再|而|错字|人称|句子|段落", bridge):
                return not _control_is_negated(clause, change.start())
    return None


class AuthorEditPolicyError(ValueError):
    """Recognised author controls cannot be applied to the supplied source."""


@dataclass(frozen=True)
class ProtectedSpan:
    start: int
    end: int


@dataclass(frozen=True)
class AuthorEditPolicy:
    source_sha256: str
    author_requirements: tuple[str, ...] = field(default=(), repr=False)
    instruction: str = field(default="", repr=False)
    baseline: str = field(default="", repr=False)
    allowed_punctuation_forms: frozenset[str] = frozenset()
    preserve_repeated_marks: bool = False
    allow_person_change: bool = False
    protected_spans: tuple[ProtectedSpan, ...] = ()
    version: str = POLICY_VERSION

    def summary(self) -> dict[str, object]:
        return {
            "version": self.version,
            "source_sha256": self.source_sha256,
            "author_requirement_count": len(self.author_requirements),
            "baseline_present": bool(self.baseline),
            "allowed_punctuation_forms": sorted(self.allowed_punctuation_forms),
            "preserve_repeated_marks": self.preserve_repeated_marks,
            "allow_person_change": self.allow_person_change,
            "protected_span_count": len(self.protected_spans),
        }


def author_command_text(instruction: str) -> str:
    text = _ANCHOR.sub("", instruction)
    markers = [
        text.find(marker)
        for marker in ("<<<ANCHOR", "<<<FILE", "<<<CONTEXT", "\n\n最小改动约束", "\n\n上一轮多视角审稿报告")
    ]
    return text[: min(index for index in markers if index >= 0)] if any(index >= 0 for index in markers) else text


def build_author_edit_policy(
    original: str,
    *,
    instruction: str = "",
    author_requirements: tuple[str, ...] = (),
    baseline: str = "",
    protected_spans: tuple[ProtectedSpan, ...] = (),
) -> AuthorEditPolicy:
    requirements = tuple(dict.fromkeys(text for text in author_requirements if isinstance(text, str) and text.strip()))
    command = author_command_text(instruction)
    allowed: set[str] = set()
    preserve_repeated = False
    person_change = False
    spans = list(protected_spans)
    for text in (*requirements, command):
        authorised_text, protected_literals = _author_control_projection(author_command_text(text))
        for literal in protected_literals:
            offsets = list(re.finditer(re.escape(literal), original))
            if not offsets:
                raise AuthorEditPolicyError("明确要求逐字保留的片段不在当前正文中，请重新指定。")
            spans.extend(ProtectedSpan(item.start(), item.end()) for item in offsets)
        for clause in re.split(r"[。；;，,\n]", authorised_text):
            if "引号" in clause:
                quote_control = _quote_change_control(clause)
                if quote_control is True:
                    allowed.add("quotes")
                elif quote_control is False or re.search(r"保留|保持|不改|不要改|别改|不调整|不要调整", clause):
                    allowed.discard("quotes")
            repeated = re.search(
                r"(?:保留|保持).*(?:重复|连续).*(?:问号|感叹号)|(?:不折|不要折|不合并).*(?:问号|感叹号)", clause
            )
            if repeated:
                # A later explicit denial also withdraws an older file control.
                preserve_repeated = not _control_is_negated(clause, repeated.start())
            if re.search(r"(?:重复|连续).*(?:问号|感叹号).*(?:折成一个|合并成一个)", clause) and "不要" not in clause:
                preserve_repeated = False
            person = re.search(r"(?:改为|改成|换成|转换为|改用).*(?:第一|第二|第三)人称", clause)
            if person:
                person_change = not _control_is_negated(clause, person.start())
            if "人称" in clause and re.search(r"不改|不要改|别改|保留|保持", clause):
                person_change = False
    spans = sorted(set(spans), key=lambda item: (item.start, item.end))
    if len(spans) > 64:
        raise AuthorEditPolicyError("明确保护片段超过预算，请分批指定。")
    previous = 0
    for span in spans:
        if (
            type(span.start) is not int
            or type(span.end) is not int
            or not 0 <= span.start < span.end <= len(original)
            or span.start < previous
        ):
            raise AuthorEditPolicyError("明确保护片段范围无效或重叠。")
        previous = span.end
    return AuthorEditPolicy(
        source_sha256=hashlib.sha256(original.encode("utf-8")).hexdigest(),
        author_requirements=requirements,
        instruction=command,
        baseline=baseline,
        allowed_punctuation_forms=frozenset(allowed),
        preserve_repeated_marks=preserve_repeated,
        allow_person_change=person_change,
        protected_spans=tuple(spans),
    )


def author_edit_policy_prompt(policy: AuthorEditPolicy) -> str:
    lines = ["本次编辑政策（writer、后处理与本地候选共用）：", json.dumps(policy.summary(), ensure_ascii=False)]
    if policy.baseline:
        lines.extend(["历史声音统计仅作参考，不能覆盖作者声明：", policy.baseline])
    if policy.author_requirements:
        lines.extend(["作者声明的声音与保留要求：", *policy.author_requirements])
    lines.extend(["当前真实作者要求：", policy.instruction or "没有额外编辑授权。"])
    if "quotes" in policy.allowed_punctuation_forms:
        lines.append("本次明确允许修改正文引号形态；这不授权改受保护结构或其他未点名内容。")
    if policy.preserve_repeated_marks:
        lines.append("重复问号和感叹号必须原样保留，不能折成单个。")
    return "\n".join(lines)


def author_edit_policy_failures(original: str, candidate: str, policy: AuthorEditPolicy) -> tuple[str, ...]:
    if policy.version != POLICY_VERSION or not policy.allowed_punctuation_forms <= {"quotes"}:
        return ("edit_policy_invalid",)
    if policy.source_sha256 != hashlib.sha256(original.encode("utf-8")).hexdigest():
        return ("edit_policy_source_mismatch",)
    previous = 0
    if len(policy.protected_spans) > 64:
        return ("edit_policy_invalid",)
    for span in policy.protected_spans:
        if (
            type(span.start) is not int
            or type(span.end) is not int
            or not 0 <= span.start < span.end <= len(original)
            or span.start < previous
        ):
            return ("edit_policy_invalid",)
        previous = span.end
    end = 0
    for span in policy.protected_spans:
        literal = original[span.start : span.end]
        offset = candidate.find(literal, end)
        if offset < 0 or candidate.count(literal) != original.count(literal):
            return ("protected_span_changed",)
        end = offset + len(literal)
    if policy.preserve_repeated_marks:
        before = re.findall(r"[？?！!]{2,}", original)
        after = re.findall(r"[？?！!]{2,}", candidate)
        if before != after:
            return ("protected_emphasis_changed",)
    return ()
