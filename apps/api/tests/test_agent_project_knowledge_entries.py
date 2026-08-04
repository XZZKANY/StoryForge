from __future__ import annotations

from dataclasses import replace

import pytest

from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeEntryError,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    parse_knowledge_markdown,
    render_knowledge_entry,
    upsert_knowledge_entry,
)


def test_structured_knowledge_entry_round_trips_through_public_fs_face() -> None:
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440000",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title="天枢架位不可移动",
        claim="天枢是固定架位，不是可携带物品。",
        sources=(
            KnowledgeSource(
                type="project_file",
                path="设定/天枢.md",
                content_sha256="sha256:" + "a" * 64,
            ),
        ),
        claim_fingerprint=knowledge_claim_fingerprint(
            "天枢架位不可移动",
            "天枢是固定架位，不是可携带物品。",
        ),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )

    rendered = render_knowledge_entry(entry)
    parsed = parse_knowledge_markdown(rendered)

    assert parsed.entries == (entry,)
    assert parsed.warnings == ()
    assert rendered.startswith("<!-- storyforge-knowledge:v1\n{")
    assert rendered.endswith("<!-- /storyforge-knowledge -->\n")


def test_malformed_block_is_isolated_from_later_valid_entry() -> None:
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440001",
        status="active",
        kind="writing_rule",
        evidence_state="current",
        title="叙事视角",
        claim="正文统一使用第三人称限知视角。",
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_42"),),
        claim_fingerprint=knowledge_claim_fingerprint("叙事视角", "正文统一使用第三人称限知视角。"),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )
    malformed = """<!-- storyforge-knowledge:v1
{not-json}
-->
## 损坏条目

不能进入索引。
<!-- /storyforge-knowledge -->
"""

    parsed = parse_knowledge_markdown(malformed + render_knowledge_entry(entry))

    assert parsed.entries == (entry,)
    assert len(parsed.warnings) == 1
    assert "block 1" in parsed.warnings[0]


def test_unclosed_block_resynchronizes_at_next_versioned_marker() -> None:
    title = "时间锚点"
    claim = "祭典发生在霜降后的第三日。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440006",
        status="active",
        kind="timeline_fact",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_46"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )
    unclosed = "<!-- storyforge-knowledge:v1\n{broken metadata\n"

    parsed = parse_knowledge_markdown(unclosed + render_knowledge_entry(entry))

    assert parsed.entries == (entry,)
    assert len(parsed.warnings) == 1


@pytest.mark.parametrize("path", ["../正文/第001章.md", "C:/作品/正文.md", "file:///正文.md"])
def test_project_file_source_rejects_unsafe_relative_paths(path: str) -> None:
    title = "主角身份"
    claim = "沈砚是天枢架的守架人。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440002",
        status="active",
        kind="character_fact",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(
            KnowledgeSource(
                type="project_file",
                path=path,
                content_sha256="sha256:" + "b" * 64,
            ),
        ),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )

    with pytest.raises(KnowledgeEntryError, match="relative path"):
        render_knowledge_entry(entry)


def test_source_variants_reject_fields_owned_by_another_source_type() -> None:
    title = "主角身份"
    claim = "沈砚是天枢架的守架人。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440007",
        status="active",
        kind="character_fact",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(
            KnowledgeSource(
                type="project_file",
                path="正文/第001章.md",
                content_sha256="sha256:" + "c" * 64,
                agent_event_id="ake_must_not_leak",
            ),
        ),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )

    with pytest.raises(KnowledgeEntryError, match="unexpected fields"):
        render_knowledge_entry(entry)


def test_upsert_appends_structured_entry_without_rewriting_author_markdown() -> None:
    existing = "# 世界设定\n\n这里是作者手写的旧设定。\n"
    title = "灵脉不可逆"
    claim = "灵脉一旦断裂，不能通过丹药恢复。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440003",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_43"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )

    compiled = upsert_knowledge_entry(existing, entry)

    assert compiled.startswith(existing)
    assert compiled == existing + "\n" + render_knowledge_entry(entry)
    assert parse_knowledge_markdown(compiled).entries == (entry,)


def test_upsert_replaces_matching_entry_and_preserves_stable_id() -> None:
    title = "灵脉不可逆"
    original_claim = "灵脉一旦断裂，不能自然恢复。"
    original = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440004",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=original_claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_44"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, original_claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )
    revised_claim = "灵脉一旦断裂，不能自然恢复，也不能通过丹药修复。"
    revised = replace(
        original,
        claim=revised_claim,
        claim_fingerprint=knowledge_claim_fingerprint(title, revised_claim),
        updated_at="2026-08-03T11:00:00Z",
    )
    before = "# 世界设定\n\n作者前言。\n\n" + render_knowledge_entry(original) + "\n作者后记。\n"

    compiled = upsert_knowledge_entry(before, revised)

    assert compiled.startswith("# 世界设定\n\n作者前言。\n\n")
    assert compiled.endswith("\n作者后记。\n")
    assert original_claim not in compiled
    assert parse_knowledge_markdown(compiled).entries == (revised,)


@pytest.mark.parametrize("timestamp", ["2026-08-03 10:00:00", "2026-08-03T10:00:00+08:00", "not-a-time"])
def test_knowledge_entry_requires_utc_iso_timestamps(timestamp: str) -> None:
    title = "叙事规范"
    claim = "每章使用单一视角人物。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440005",
        status="active",
        kind="writing_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_45"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at=timestamp,
        updated_at="2026-08-03T10:00:00Z",
    )

    with pytest.raises(KnowledgeEntryError, match="UTC ISO-8601"):
        render_knowledge_entry(entry)


@pytest.mark.parametrize(
    ("status", "superseded_by"),
    [
        ("active", "pk_550e8400-e29b-41d4-a716-446655440099"),
        ("superseded", None),
    ],
)
def test_superseded_lifecycle_requires_a_consistent_replacement_link(
    status: str,
    superseded_by: str | None,
) -> None:
    title = "旧规则"
    claim = "旧规则仍保留供审计。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440008",
        status=status,  # type: ignore[arg-type]
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_47"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
        superseded_by=superseded_by,
    )

    with pytest.raises(KnowledgeEntryError, match="superseded_by"):
        render_knowledge_entry(entry)
