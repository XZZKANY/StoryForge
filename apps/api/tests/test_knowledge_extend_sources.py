"""C08：extend 来源并集——同路径新旧 hash 不能都作当前依赖。

报告 §3 C08（旧第 16 页）：同路径新旧 hash 都作当前依赖，自报 current 但实时
核验 stale；回滚旧版本仍 stale。extend 应让新证据替换同路径旧证据。
"""

from __future__ import annotations

from app.domains.agent_runs.events.knowledge_materialization import _compile_operation
from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
)

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def _entry(n: int, title: str, claim: str, sources: tuple[KnowledgeSource, ...]) -> KnowledgeEntry:
    return KnowledgeEntry(
        id=f"pk_550e8400-e29b-41d4-a716-44665544{n:04d}",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=sources,
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-10-04T00:00:00Z",
        updated_at="2026-10-04T00:00:00Z",
    )


def test_extend_replaces_same_path_old_hash(novel_project) -> None:
    """同路径 project_file source：extend 只保留 proposed 的最新 hash。"""
    old_hash = "sha256:" + "1" * 64
    new_hash = "sha256:" + "2" * 64
    current = _entry(
        1,
        "夜航规则",
        "旧版规则。",
        (KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256=old_hash),),
    )
    proposed = _entry(
        99,
        "夜航规则",
        "新版规则。",
        (KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256=new_hash),),
    )
    before = __import__("app.domains.agent_runs.fs", fromlist=["render_knowledge_entry"]).render_knowledge_entry(
        current
    )

    after, materialized = _compile_operation(
        before,
        proposed,
        operation="extend",
        related_knowledge_ids=[current.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    from app.domains.agent_runs.fs import parse_knowledge_markdown

    by_id = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}
    revised = by_id[current.id]
    same_path = [s for s in revised.sources if s.type == "project_file" and s.path == "正文/第01章.md"]
    # 同路径只保留新 hash，不能新旧并集堆积。
    assert len(same_path) == 1
    assert same_path[0].content_sha256 == new_hash
    # 自报 evidence_state 与实时核验一致（只有新 hash 需要匹配）。
    assert revised.evidence_state == "current"


def test_extend_keeps_different_path_sources(novel_project) -> None:
    """不同路径的 sources 仍取并集（新证据补充，不是替换）。"""
    hash_a = "sha256:" + "a" * 64
    hash_b = "sha256:" + "b" * 64
    current = _entry(
        2,
        "双源规则",
        "旧版。",
        (KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256=hash_a),),
    )
    proposed = _entry(
        98,
        "双源规则",
        "新版。",
        (KnowledgeSource(type="project_file", path="设定/人物.md", content_sha256=hash_b),),
    )
    from app.domains.agent_runs.fs import parse_knowledge_markdown, render_knowledge_entry

    before = render_knowledge_entry(current)
    after, _ = _compile_operation(
        before,
        proposed,
        operation="extend",
        related_knowledge_ids=[current.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    revised = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}[current.id]
    paths = {s.path for s in revised.sources if s.type == "project_file"}
    assert paths == {"正文/第01章.md", "设定/人物.md"}


def test_extend_dedupes_identical_sources(novel_project) -> None:
    """完全相同的 source 仍去重（回归护栏）。"""
    same = KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256="sha256:" + "c" * 64)
    current = _entry(3, "单源规则", "旧版。", (same,))
    proposed = _entry(97, "单源规则", "新版。", (same,))
    from app.domains.agent_runs.fs import parse_knowledge_markdown, render_knowledge_entry

    before = render_knowledge_entry(current)
    after, _ = _compile_operation(
        before,
        proposed,
        operation="extend",
        related_knowledge_ids=[current.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    revised = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}[current.id]
    assert revised.sources == (same,)


def test_extend_mixed_source_types(novel_project) -> None:
    """author_statement 与 project_file 并存：同路径替换，其余保留。"""
    old_hash = "sha256:" + "d" * 64
    new_hash = "sha256:" + "e" * 64
    statement = KnowledgeSource(type="author_statement", agent_event_id="ake_1")
    current = _entry(
        4,
        "混合规则",
        "旧版。",
        (
            KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256=old_hash),
            statement,
        ),
    )
    proposed = _entry(
        96,
        "混合规则",
        "新版。",
        (KnowledgeSource(type="project_file", path="正文/第01章.md", content_sha256=new_hash),),
    )
    from app.domains.agent_runs.fs import parse_knowledge_markdown, render_knowledge_entry

    before = render_knowledge_entry(current)
    after, _ = _compile_operation(
        before,
        proposed,
        operation="extend",
        related_knowledge_ids=[current.id],
        updated_at="2026-10-04T00:00:00Z",
    )
    revised = {entry.id: entry for entry in parse_knowledge_markdown(after).entries}[current.id]
    project_sources = [s for s in revised.sources if s.type == "project_file"]
    assert len(project_sources) == 1
    assert project_sources[0].content_sha256 == new_hash
    assert statement in revised.sources
