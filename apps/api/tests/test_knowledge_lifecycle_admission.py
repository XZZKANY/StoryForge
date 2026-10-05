"""知识生命周期准入：损坏块不回落 raw、混合说明保留、失效知识不经 raw 重入。

对应报告 §3 C04/C05/C06：损坏块导致的路径必须进 structured_paths 以阻止 raw 重入；
普通作者说明（非块文本）在合法 active 块保留时不能消失，且 warnings 非空。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.fs import render_knowledge_entry
from app.domains.agent_runs.fs.knowledge_entries import KnowledgeEntry, KnowledgeSource, knowledge_claim_fingerprint
from app.domains.agent_runs.knowledge_context import (
    collect_project_knowledge_context,
    merge_project_knowledge_entries,
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


def _corrupt_claim_fingerprint(content: str) -> str:
    """把第一个 claim_fingerprint 改成错误值，制造 fingerprint 不匹配。"""
    return content.replace(
        '"claim_fingerprint":"sha256:',
        '"claim_fingerprint":"sha256:0000000000000000000000000000000000000000000000000000000000000000"',
        1,
    ).replace(
        # 第二个 sha256 才是 fingerprint 的值；第一个 0 链是占位
        '0000000000000000000000000000000000000000000000000000000000000000',
        '0' * 64,
        1,
    )


# ---------------------------------------------------------------------------
# C05：损坏块（fingerprint 不匹配）不能绕过生命周期政策回落 raw
# ---------------------------------------------------------------------------


def test_corrupt_block_does_not_leak_retired_claim_via_raw(novel_project: Path) -> None:
    """手改 claim 造成 fingerprint 不匹配：解析有警告，retired 文字不能进 writer。"""
    entry = _make_entry(1, "旧规则", status="retired", claim="RETIRED_CLAIM_SENTINEL")
    raw = render_knowledge_entry(entry)
    corrupt = _corrupt_claim_fingerprint(raw)
    (novel_project / "设定" / "旧规则.md").write_text(corrupt, encoding="utf-8")

    bundle = {
        "project_root": str(novel_project),
        "files": [
            {
                "relative_path": "设定/旧规则.md",
                "kind": "knowledge",
                "excerpt": "RETIRED_CLAIM_SENTINEL",
            }
        ],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="旧规则")
    assert knowledge.result is not None
    # 损坏块无有效条目，但路径必须进 structured_paths 以阻止 raw 重入。
    assert knowledge.result.items == ()
    assert "设定/旧规则.md" in knowledge.result.structured_paths

    merged, warnings = merge_project_knowledge_entries(
        knowledge, context_files=bundle["files"], max_context_files=8
    )
    # 路径被排除 → retired 文字不能经 raw 到 writer。
    assert all("RETIRED_CLAIM_SENTINEL" not in (item.get("excerpt") or "") for item in merged)
    # 解析警告必须上报，不能静默。
    assert any("旧规则" in warning or "fingerprint" in warning.lower() for warning in warnings)


def test_corrupt_block_only_file_reports_structured_path(novel_project: Path) -> None:
    """文件里只有损坏块（零有效条目）时，路径同样要进 structured_paths。"""
    entry = _make_entry(2, "争议规则", status="disputed", claim="DISPUTED_CLAIM_SENTINEL")
    raw = render_knowledge_entry(entry)
    corrupt = _corrupt_claim_fingerprint(raw)
    (novel_project / "设定" / "争议.md").write_text(corrupt, encoding="utf-8")

    bundle = {
        "project_root": str(novel_project),
        "files": [
            {"relative_path": "设定/争议.md", "kind": "knowledge", "excerpt": "DISPUTED_CLAIM_SENTINEL"}
        ],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="争议")
    assert knowledge.result is not None
    assert knowledge.result.items == ()
    assert "设定/争议.md" in knowledge.result.structured_paths

    merged, _ = merge_project_knowledge_entries(knowledge, context_files=bundle["files"], max_context_files=8)
    assert merged == []


# ---------------------------------------------------------------------------
# C04：失效知识（retired/disputed/superseded）不经 raw 重入
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["retired", "disputed"])
def test_inactive_knowledge_does_not_reenter_via_raw(novel_project: Path, status: str) -> None:
    """status 非 active 的条目：select 已排除，但 raw 文件若漏进 bundle 仍会带旧文字。"""
    entry = _make_entry(3, "旧规则", status=status, claim="INACTIVE_CLAIM_SENTINEL")
    (novel_project / "设定" / "旧规则.md").write_text(render_knowledge_entry(entry), encoding="utf-8")

    bundle = {
        "project_root": str(novel_project),
        "files": [
            {"relative_path": "设定/旧规则.md", "kind": "knowledge", "excerpt": "INACTIVE_CLAIM_SENTINEL"}
        ],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="旧规则")
    assert knowledge.result is not None
    assert knowledge.result.items == ()
    assert "设定/旧规则.md" in knowledge.result.structured_paths

    merged, _ = merge_project_knowledge_entries(knowledge, context_files=bundle["files"], max_context_files=8)
    assert merged == []


def test_superseded_knowledge_does_not_reenter_via_raw(novel_project: Path) -> None:
    old = _make_entry(4, "旧规则", status="superseded", superseded_by="pk_550e8400-e29b-41d4-a716-446655440099")
    new = _make_entry(99, "新规则")
    (novel_project / "设定" / "规则.md").write_text(
        render_knowledge_entry(old) + "\n" + render_knowledge_entry(new), encoding="utf-8"
    )

    bundle = {
        "project_root": str(novel_project),
        "files": [
            {"relative_path": "设定/规则.md", "kind": "knowledge", "excerpt": "SUPERSEDED_SENTINEL 新规则"}
        ],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="新规则")
    assert knowledge.result is not None
    # 新规则 active → 被选中；旧规则 superseded → 不进 items。
    selected_ids = [item.entry.id for item in knowledge.result.items]
    assert new.id in selected_ids
    assert old.id not in selected_ids
    assert "设定/规则.md" in knowledge.result.structured_paths


# ---------------------------------------------------------------------------
# C06：混合普通说明（非块文本）在合法 active 块保留时不能消失
# ---------------------------------------------------------------------------


def test_mixed_author_notes_survive_alongside_active_block(novel_project: Path) -> None:
    """同文件合法 active 块保留，普通作者说明（块外文本）不能消失，warnings 非空。"""
    entry = _make_entry(5, "夜航规则", claim="夜航必须点灯。")
    author_note = "作者注：这条规则只在第二卷生效，别外推到第一卷。"
    raw = render_knowledge_entry(entry) + "\n" + author_note + "\n"
    (novel_project / "设定" / "夜航.md").write_text(raw, encoding="utf-8")

    bundle = {
        "project_root": str(novel_project),
        "files": [
            {
                "relative_path": "设定/夜航.md",
                "kind": "knowledge",
                "excerpt": "夜航必须点灯。 " + author_note,
            }
        ],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="夜航")
    assert knowledge.result is not None
    assert len(knowledge.result.items) == 1

    merged, warnings = merge_project_knowledge_entries(
        knowledge, context_files=bundle["files"], max_context_files=8
    )
    # 合法 active 块被选中（结构化知识条目存在）。
    assert any(item.get("knowledge_id") == entry.id for item in merged)
    # 普通作者说明必须保留在某个 context_file 里（raw 或结构化），不能整文件删 raw。
    delivered = "\n".join(item.get("excerpt") or "" for item in merged)
    assert "作者注" in delivered or "只在第二卷生效" in delivered
    # 混合文件必须产生警告（提示作者该文件含非结构化说明）。
    assert any("non-structured author notes" in warning or "作者说明" in warning or "混合" in warning for warning in warnings)


def test_plain_author_notes_without_structured_blocks_pass_through(novel_project: Path) -> None:
    """纯普通说明文件（无任何知识块）不应被 structured_paths 排除。"""
    note = "作者注：主角的名字暂定，后续可能改。"
    (novel_project / "设定" / "备忘.md").write_text(note, encoding="utf-8")

    bundle = {
        "project_root": str(novel_project),
        "files": [{"relative_path": "设定/备忘.md", "kind": "knowledge", "excerpt": note}],
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=bundle["files"], query="备忘")
    # 纯说明文件没有可解析条目 → result 为 None 或 items 为空，structured_paths 不含它。
    if knowledge.result is not None:
        assert "设定/备忘.md" not in knowledge.result.structured_paths

    merged, _ = merge_project_knowledge_entries(knowledge, context_files=bundle["files"], max_context_files=8)
    assert any("作者注" in (item.get("excerpt") or "") for item in merged)
