from __future__ import annotations

from storyforge_workflow.nodes.continuity_extractor import parse_continuity_edges


def test_parses_valid_json_array() -> None:
    raw = """[
        {"edge_kind": "relationship", "subject_ref": "character:林岚", "predicate": "父", "object_ref": "character:林父"},
        {"edge_kind": "timeline_order", "subject_ref": "event:出海", "predicate": "早于", "object_ref": "event:爆炸"}
    ]"""
    edges = parse_continuity_edges(raw)
    assert len(edges) == 2
    assert edges[0]["edge_kind"] == "relationship"
    assert edges[0]["subject_ref"] == "character:林岚"
    assert edges[1]["predicate"] == "早于"


def test_strips_json_code_fence() -> None:
    raw = '```json\n[{"edge_kind":"status","subject_ref":"character:林岚","predicate":"生死","object_ref":"已死亡"}]\n```'
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1
    assert edges[0]["object_ref"] == "已死亡"


def test_strips_plain_code_fence() -> None:
    raw = '```\n[{"edge_kind":"relationship","subject_ref":"character:A","predicate":"父","object_ref":"character:B"}]\n```'
    assert len(parse_continuity_edges(raw)) == 1


def test_bad_json_returns_empty() -> None:
    assert parse_continuity_edges("这不是 JSON，模型聊起天来了") == []
    assert parse_continuity_edges("[{broken") == []


def test_non_list_returns_empty() -> None:
    assert parse_continuity_edges('{"edge_kind": "relationship"}') == []
    assert parse_continuity_edges('"just a string"') == []


def test_empty_input_returns_empty() -> None:
    assert parse_continuity_edges("") == []
    assert parse_continuity_edges("   ") == []
    assert parse_continuity_edges("[]") == []


def test_invalid_edge_kind_item_skipped_valid_kept() -> None:
    raw = """[
        {"edge_kind": "unknown_kind", "subject_ref": "a", "predicate": "p", "object_ref": "b"},
        {"edge_kind": "relationship", "subject_ref": "character:A", "predicate": "父", "object_ref": "character:B"}
    ]"""
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1
    assert edges[0]["edge_kind"] == "relationship"


def test_missing_required_fields_skipped() -> None:
    raw = """[
        {"edge_kind": "relationship", "subject_ref": "character:A", "object_ref": "character:B"},
        {"edge_kind": "relationship", "subject_ref": "", "predicate": "父", "object_ref": "character:B"},
        {"edge_kind": "relationship", "subject_ref": "character:A", "predicate": "父", "object_ref": "character:B"}
    ]"""
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1


def test_non_dict_items_skipped() -> None:
    raw = '["just a string", 42, {"edge_kind":"status","subject_ref":"character:林岚","predicate":"生死","object_ref":"活动"}]'
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1


def test_overlong_refs_truncated() -> None:
    long_ref = "character:" + "名" * 300
    raw = (
        '[{"edge_kind":"relationship","subject_ref":"' + long_ref + '","predicate":"父","object_ref":"character:B"}]'
    )
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1
    assert len(edges[0]["subject_ref"]) == 160


def test_valid_windows_carried_through() -> None:
    raw = """[
        {"edge_kind":"status","subject_ref":"character:林岚","predicate":"生死","object_ref":"已死亡","valid_from_chapter":40,"valid_to_chapter":null},
        {"edge_kind":"status","subject_ref":"character:林岚","predicate":"所在地","object_ref":"港口","valid_from_chapter":12,"valid_to_chapter":15}
    ]"""
    edges = parse_continuity_edges(raw)
    assert "valid_from_chapter" in edges[0] and edges[0]["valid_from_chapter"] == 40
    assert "valid_to_chapter" not in edges[0]  # null → 省略
    assert edges[1]["valid_to_chapter"] == 15


def test_invalid_window_values_ignored() -> None:
    raw = '[{"edge_kind":"relationship","subject_ref":"a:1","predicate":"父","object_ref":"b:1","valid_from_chapter":-5,"valid_to_chapter":"早"}]'
    edges = parse_continuity_edges(raw)
    assert len(edges) == 1
    assert "valid_from_chapter" not in edges[0]
    assert "valid_to_chapter" not in edges[0]
