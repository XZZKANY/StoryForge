"""C07：多 ID 替代不完整——supersede 应把全部关联旧 ID 标记为 superseded。

报告 §3 C07（旧第 16 页）：正常 builder 接受两个旧 ID，reducer 只替代第一条；
第二条旧规则与新规则同入 writer。
"""

from __future__ import annotations

from pathlib import Path

from app.domains.agent_runs.events.knowledge_materialization import _compile_operation
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    parse_knowledge_markdown,
    render_knowledge_entry,
)

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def _make_entry(n: int, title: str, claim: str = "固定设定。", **changes) -> KnowledgeEntry:
    base = {
        "id": f"pk_550e8400-e29b-41d4-a716-44665544{n:04d}",
        "status": "active",
        "kind": "world_rule",
        "evidence_state": "current",
        "title": title,
        "claim": claim,
        "sources": (KnowledgeSource(type="author_statement", agent_event_id=f"ake_{n}"),),
        "claim_fingerprint": knowledge_claim_fingerprint(title, claim),
        "created_at": "2026-10-04T00:00:00Z",
        "updated_at": "2026-10-04T00:00:00Z",
    }
    base.update(changes)
    return KnowledgeEntry(**base)


def _proposed(n: int, title: str, claim: str) -> KnowledgeEntry:
    return _make_entry(n, title, claim)


def test_supersede_marks_all_related_old_ids(novel_project: Path) -> None:
    """两个旧 ID 都传给 supersede：两条都必须变 superseded，不能只改第一条。"""
    old_one = _make_entry(1, "旧规则一", claim="OLD_ONE_SENTINEL")
    old_two = _make_entry(2, "旧规则二", claim="OLD_TWO_SENTINEL")
    new = _proposed(99, "合并新规则", "MERGED_NEW_SENTINEL")
    before = render_knowledge_entry(old_one) + "\n" + render_knowledge_entry(old_two)

    after, materialized = _compile_operation(
        before,
        new,
        operation="supersede",
        related_knowledge_ids=[old_one.id, old_two.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    parsed = parse_knowledge_markdown(after)
    assert parsed.warnings == ()
    by_id = {entry.id: entry for entry in parsed.entries}
    # 新规则 active。
    assert by_id[new.id].status == "active"
    assert materialized.status == "active"
    # 两条旧规则都必须标为 superseded（报告复现点：只改第一条）。
    assert by_id[old_one.id].status == "superseded"
    assert by_id[old_two.id].status == "superseded"
    # 两条旧规则的 superseded_by 都指向新 entry。
    assert by_id[old_one.id].superseded_by == new.id
    assert by_id[old_two.id].superseded_by == new.id


def test_retire_marks_all_related_old_ids(novel_project: Path) -> None:
    """retire 同根因：两个旧 ID 都应退役，不能只退役第一条。"""
    old_one = _make_entry(3, "旧规则一", claim="OLD_ONE_SENTINEL")
    old_two = _make_entry(4, "旧规则二", claim="OLD_TWO_SENTINEL")
    new = _proposed(98, "占位提议", "PLACEHOLDER")
    before = render_knowledge_entry(old_one) + "\n" + render_knowledge_entry(old_two)

    after, _ = _compile_operation(
        before,
        new,
        operation="retire",
        related_knowledge_ids=[old_one.id, old_two.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    by_id = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}
    assert by_id[old_one.id].status == "retired"
    assert by_id[old_two.id].status == "retired"


def test_dispute_marks_all_related_old_ids(novel_project: Path) -> None:
    """dispute 同根因：两个旧 ID 都应标 disputed。"""
    old_one = _make_entry(5, "旧规则一", claim="OLD_ONE_SENTINEL")
    old_two = _make_entry(6, "旧规则二", claim="OLD_TWO_SENTINEL")
    new = _proposed(97, "争议提议", "DISPUTE_SENTINEL")
    before = render_knowledge_entry(old_one) + "\n" + render_knowledge_entry(old_two)

    after, _ = _compile_operation(
        before,
        new,
        operation="dispute",
        related_knowledge_ids=[old_one.id, old_two.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    by_id = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}
    assert by_id[old_one.id].status == "disputed"
    assert by_id[old_two.id].status == "disputed"
    assert by_id[new.id].status == "disputed"


def test_extend_still_targets_first_related_entry(novel_project: Path) -> None:
    """extend 的现有语义（改写第一条旧 entry）不变——回归护栏。"""
    old_one = _make_entry(7, "旧规则一", claim="OLD_ONE_SENTINEL")
    old_two = _make_entry(8, "旧规则二", claim="OLD_TWO_SENTINEL")
    new = _proposed(96, "扩展规则", "EXTENDED_SENTINEL")
    before = render_knowledge_entry(old_one) + "\n" + render_knowledge_entry(old_two)

    after, materialized = _compile_operation(
        before,
        new,
        operation="extend",
        related_knowledge_ids=[old_one.id, old_two.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    by_id = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}
    # extend 改写第一条，保留其 id；第二条不动。
    assert by_id[old_one.id].claim == "EXTENDED_SENTINEL"
    assert by_id[old_two.id].claim == "OLD_TWO_SENTINEL"
    assert materialized.id == old_one.id


def test_single_related_id_behavior_unchanged(novel_project: Path) -> None:
    """单 ID 场景回归护栏：supersede 旧 id 标记 + 新 entry 落盘。"""
    old_one = _make_entry(9, "旧规则一", claim="OLD_ONE_SENTINEL")
    new = _proposed(95, "新规则", "NEW_SENTINEL")
    before = render_knowledge_entry(old_one)

    after, materialized = _compile_operation(
        before,
        new,
        operation="supersede",
        related_knowledge_ids=[old_one.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    by_id = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}
    assert by_id[old_one.id].status == "superseded"
    assert by_id[old_one.id].superseded_by == new.id
    assert by_id[new.id].status == "active"
    assert materialized.id == new.id
