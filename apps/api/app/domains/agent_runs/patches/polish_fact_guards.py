"""Narrow original-grounded contradictions, not a bag-of-words quality judge."""

from __future__ import annotations

import re
from collections.abc import Sequence
from difflib import SequenceMatcher
from typing import Any

from app.common.punctuation import DIALOGUE_PATTERN


def entity_spelling_changes(original: str, candidate: str, entities: Sequence[str]) -> tuple[str, ...]:
    changed: set[str] = set()
    # Work inside changed line regions, not a quadratic full-book character diff.
    before, after = original.splitlines(keepends=True), candidate.splitlines(keepends=True)
    lines = SequenceMatcher(None, before, after, autojunk=False)
    for tag, left, right, start, end in lines.get_opcodes():
        if tag != "replace":
            continue
        old, new = "".join(before[left:right]), "".join(after[start:end])
        if len(old) + len(new) > 4000:
            continue  # Long or ambiguous rewrites remain signals, not spelling proof.
        matcher = SequenceMatcher(None, old, new, autojunk=False)
        for operation, a, b, x, y in matcher.get_opcodes():
            if operation != "replace" or b - a != 1 or y - x != 1:
                continue
            for entity in entities:
                for occurrence in re.finditer(re.escape(entity), old):
                    if not occurrence.start() <= a < occurrence.end():
                        continue
                    offset = a - occurrence.start()
                    spelling = entity[:offset] + new[x:y] + entity[offset + 1 :]
                    # An exact one-character substitution at a protected name,
                    # with the new spelling actually present in the candidate.
                    if spelling in new and spelling not in old:
                        changed.add(entity)
    return tuple(f"protected_entity_changed:{entity}" for entity in entities if entity in changed)


def grounded_fact_contradictions(
    original: str,
    candidate: str,
    *,
    entities: Sequence[str],
    facts: Sequence[Any],
) -> tuple[str, ...]:
    before, after = DIALOGUE_PATTERN.sub("", original), DIALOGUE_PATTERN.sub("", candidate)
    before_assertions = set(_assertions(before))
    after_assertions = set(_assertions(after))
    reasons = []
    for fact in facts:
        statement = fact.get("statement") if isinstance(fact, dict) else fact
        if not isinstance(statement, str):
            continue
        for assertion in _assertions(statement):
            if assertion not in before_assertions:
                continue
            # Only negate the predicate of the actual same assertion. A nearby
            # "院里没有人" says nothing about "钥匙在林岚手中".
            predicate = re.search(r"属于|持有|已经|能够|在|是|有", assertion)
            if predicate is None:
                continue
            prefix, suffix = assertion[: predicate.start()], assertion[predicate.start() :]
            if not prefix or any(marker in prefix for marker in ("不", "没", "未")):
                continue
            for negation in ("不", "并不", "没有", "并未", "从未"):
                contradiction = prefix + negation + suffix
                if contradiction in after_assertions and contradiction not in before_assertions:
                    reasons.append("grounded_fact_contradicted")
    original_events = _transfer_events(before, entities)
    candidate_events = _transfer_events(after, entities)
    for actor, obj, recipient, negated in original_events:
        if (recipient, obj, actor, negated) in candidate_events and actor != recipient:
            reasons.append("event_relation_changed")
        if (actor, obj, recipient, not negated) in candidate_events:
            reasons.append("event_relation_changed")
    return tuple(dict.fromkeys(reasons))


def _assertions(text: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in re.split(r"[。！？!?；;，,\n]", text) if part.strip())


def _transfer_events(prose: str, entities: Sequence[str]) -> set[tuple[str, str, str, bool]]:
    names = [name for name in entities if isinstance(name, str) and name.strip()]
    if len(names) < 2:
        return set()
    actors = "|".join(re.escape(name) for name in sorted(set(names), key=len, reverse=True))
    pattern = re.compile(
        rf"(?P<actor>{actors})(?P<negation>没有|并未|没|不)?把(?P<object>[^。！？!?，,\n]{{1,40}}?)"
        rf"(?:交给|递给|送给)(?P<recipient>{actors})"
    )
    return {
        (m["actor"], m["object"].strip(), m["recipient"], bool(m["negation"]))
        for clause in _assertions(prose)
        if (m := pattern.fullmatch(clause)) is not None
    }
