from __future__ import annotations

from app.domains.agent_runs.patches import (
    PolishCandidate,
    PolishGateConfig,
    apply_deterministic_polish,
    evaluate_polish_candidate,
    rebuild_polishable_markdown,
    select_polish_candidate,
    split_polishable_markdown,
)

SOURCE = """---
title: 第七码头
tags: [悬疑]
---
# 第十二章 雨夜

以下是润色后的版本：

林岚推开门，，握紧刀！！她看向顾迟，顾迟没有说话。

```json
{"clue": "red-key"}
```

“顾迟，你还记得七码头吗？”
"""


def test_split_and_rebuild_keep_protected_markdown_byte_exact() -> None:
    document = split_polishable_markdown(SOURCE)

    assert document.polishable_parts
    assert all("title: 第七码头" not in part for part in document.polishable_parts)
    assert all("red-key" not in part for part in document.polishable_parts)
    assert rebuild_polishable_markdown(document, document.polishable_parts) == SOURCE

    protected = [(segment.kind, segment.text) for segment in document.segments if segment.protected]
    assert protected == [
        ("frontmatter", "---\ntitle: 第七码头\ntags: [悬疑]\n---\n"),
        ("heading", "# 第十二章 雨夜\n"),
        ("fenced_block", '```json\n{"clue": "red-key"}\n```\n'),
    ]


def test_unclosed_frontmatter_or_fence_fails_closed() -> None:
    frontmatter = split_polishable_markdown("---\ntitle: 未闭合\n正文")
    fence = split_polishable_markdown("# 标题\n\n正文\n```json\n{\"secret\": true}")

    assert frontmatter.polishable_parts == ()
    assert rebuild_polishable_markdown(frontmatter, ()) == "---\ntitle: 未闭合\n正文"
    assert fence.polishable_parts == ("\n正文\n",)
    assert "secret" not in fence.polishable_parts[0]


def test_deterministic_polish_is_conservative_and_idempotent() -> None:
    once = apply_deterministic_polish(SOURCE)
    twice = apply_deterministic_polish(once)

    assert once == twice
    assert "以下是润色后的版本：" not in once
    assert "门，握紧刀！" in once
    assert "title: 第七码头" in once
    assert '{"clue": "red-key"}' in once


def test_gate_rejects_protected_structure_drift() -> None:
    candidate = SOURCE.replace("# 第十二章 雨夜", "# 第十二章 晴天")

    result = evaluate_polish_candidate(SOURCE, candidate)

    assert result.passed is False
    assert "protected_structure_changed" in result.reasons


def test_gate_rejects_empty_truncated_and_word_count_drift() -> None:
    empty = evaluate_polish_candidate(SOURCE, "")
    truncated = evaluate_polish_candidate(SOURCE, SOURCE, response_truncated=True)
    short = evaluate_polish_candidate(
        "# 标题\n\n" + "林岚推门向前。" * 30,
        "# 标题\n\n林岚推门。",
    )

    assert "empty_candidate" in empty.reasons
    assert "response_truncated" in truncated.reasons
    assert "word_count_drift" in short.reasons


def test_gate_rejects_entity_count_and_narrative_person_drift() -> None:
    original = "# 标题\n\n" + "我推开门，看见林岚。我们没有退路。" * 6
    entity_drift = original.replace("林岚", "林蓝", 1)
    person_drift = original.replace("我们", "他们").replace("我推", "他推")

    entity_result = evaluate_polish_candidate(original, entity_drift, protected_entities=("林岚",))
    person_result = evaluate_polish_candidate(original, person_drift)

    assert "protected_entity_changed:林岚" in entity_result.reasons
    assert "narrative_person_changed" in person_result.reasons


def test_gate_rejects_new_static_prose_regression() -> None:
    original = "# 标题\n\n他推开门，握紧刀，转身看向巷口，又停下。"
    candidate = "# 标题\n\n他不禁推开门，心中五味杂陈，握紧刀，转身看向巷口，又停下。"

    result = evaluate_polish_candidate(original, candidate, config=PolishGateConfig(max_char_ratio=2.0))

    assert result.passed is False
    assert "prose_issue_regressed" in result.reasons


def test_selection_prefers_passing_online_candidate() -> None:
    original = "# 标题\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"
    local = apply_deterministic_polish(original)
    online = "# 标题\n\n林岚推开门，握紧刀！她转身望向巷口，又停下。"

    decision = select_polish_candidate(
        original,
        local_candidate=PolishCandidate(source="local", text=local),
        online_candidate=PolishCandidate(source="online", text=online),
        protected_entities=("林岚",),
    )

    assert decision.status == "accepted"
    assert decision.selected_source == "online"
    assert decision.text == online
    assert decision.degraded is False


def test_selection_uses_passing_local_candidate_when_online_fails() -> None:
    original = "# 标题\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"
    local = apply_deterministic_polish(original)
    online = original.replace("林岚", "林蓝")

    decision = select_polish_candidate(
        original,
        local_candidate=PolishCandidate(source="local", text=local),
        online_candidate=PolishCandidate(source="online", text=online),
        protected_entities=("林岚",),
    )

    assert decision.status == "degraded"
    assert decision.selected_source == "local"
    assert decision.text == local
    assert decision.degraded is True
    assert "protected_entity_changed:林岚" in decision.evaluations["online"].reasons


def test_selection_keeps_original_when_both_candidates_fail() -> None:
    original = "# 标题\n\n" + "林岚推开门。" * 20

    decision = select_polish_candidate(
        original,
        local_candidate=PolishCandidate(source="local", text=""),
        online_candidate=PolishCandidate(source="online", text="# 标题\n\n林蓝推门。", response_truncated=True),
        protected_entities=("林岚",),
    )

    assert decision.status == "rejected"
    assert decision.selected_source == "original"
    assert decision.text == original


def test_selection_reports_noop_instead_of_empty_patch() -> None:
    original = "# 标题\n\n林岚推开门，握紧刀。"

    decision = select_polish_candidate(
        original,
        local_candidate=PolishCandidate(source="local", text=original),
        online_candidate=None,
        protected_entities=("林岚",),
    )

    assert decision.status == "noop"
    assert decision.selected_source == "original"
    assert decision.text == original
