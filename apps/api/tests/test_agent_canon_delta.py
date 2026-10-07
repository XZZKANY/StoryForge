"""project.canon_delta 确定性 canon 提案：不调用 LLM、不写作者 canon。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.agent_runs import canon_store
from app.domains.agent_runs.canon_delta import canon_delta
from app.domains.agent_runs.fs_tools import FsToolError

_QINGYAN = {
    "id": "char_qingyan",
    "canonical_name": "青岩",
    "kind": "character",
    "aliases": ["剑主"],
}
_YUER = {
    "id": "char_yuer",
    "canonical_name": "月儿",
    "kind": "character",
    "aliases": ["少主"],
}


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("青岩握着断魂刀。\n", encoding="utf-8")
    (tmp_path / "正文" / "第02章.md").write_text("月儿来到旧港。\n", encoding="utf-8")
    return tmp_path


def _write_canon(project: Path, canon: dict[str, object]) -> Path:
    canon_dir = project / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)
    canon_file = canon_dir / "canon.json"
    canon_file.write_text(json.dumps(canon, ensure_ascii=False, indent=2), encoding="utf-8")
    return canon_file


def _base_canon() -> dict[str, object]:
    return {
        "version": 1,
        "entities": [_QINGYAN, _YUER],
        "invariants": {},
    }


def test_known_entities_match_canonical_name_and_alias_and_new_entity_is_proposed(project: Path) -> None:
    _write_canon(project, _base_canon())

    result = canon_delta(
        str(project),
        entities=[{"name": "青岩"}, {"name": "剑主"}, {"name": "新客", "aliases": ["黑衣人"]}],
    )

    known = result["proposals"]["known_entities"]
    assert [item["matched_id"] for item in known] == ["char_qingyan", "char_qingyan"]
    new_entity = result["proposals"]["new_entities"][0]
    assert new_entity == {
        "id": "ent_8f0edad2",
        "canonical_name": "新客",
        "aliases": ["黑衣人"],
    }


@pytest.mark.parametrize(
    "entities",
    [
        [{"name": "青岩", "aliases": ["月儿"]}],
        [{"name": "共用名"}],
    ],
)
def test_alias_conflict_detects_cross_entity_surface_matches(
    project: Path,
    entities: list[dict[str, object]],
) -> None:
    canon = _base_canon()
    if entities[0]["name"] == "共用名":
        canon["entities"] = [
            {**_QINGYAN, "aliases": ["共用名"]},
            {**_YUER, "aliases": ["共用名"]},
        ]
    _write_canon(project, canon)

    result = canon_delta(str(project), entities=entities)

    assert len(result["alias_conflicts"]) == 1
    assert result["alias_conflicts"][0]["rule"] == "alias_conflict"
    assert result["alias_conflicts"][0]["matched_ids"] == ["char_qingyan", "char_yuer"]


def test_single_entity_match_has_no_alias_conflict(project: Path) -> None:
    _write_canon(project, _base_canon())

    result = canon_delta(str(project), entities=[{"name": "青岩", "aliases": ["剑主"]}])

    assert result["alias_conflicts"] == []
    assert result["proposals"]["known_entities"][0]["matched_id"] == "char_qingyan"


def test_new_conflict_excludes_baseline_conflict(project: Path) -> None:
    canon = _base_canon()
    canon["invariants"] = {
        "single_holder": [
            {"item": "旧刀", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": 5},
            {"item": "旧刀", "holder": "char_yuer", "from_chapter": 3, "to_chapter": 6},
            {"item": "断魂刀", "holder": "char_qingyan", "from_chapter": 1, "to_chapter": 10},
        ]
    }
    _write_canon(project, canon)

    result = canon_delta(
        str(project),
        holder_claims=[{"item": "断魂刀", "holder": "char_yuer", "from_chapter": 5, "to_chapter": 8}],
    )

    assert len(result["new_conflicts"]) == 1
    assert result["new_conflicts"][0]["item"] == "断魂刀"
    assert all(item.get("item") != "旧刀" for item in result["new_conflicts"])


def test_exit_claim_introduces_new_advisory(project: Path) -> None:
    _write_canon(project, _base_canon())

    result = canon_delta(
        str(project),
        exit_claims=[{"entity": "char_yuer", "exits_after_chapter": 1, "reason": "离城"}],
    )

    assert len(result["new_advisories"]) == 1
    assert result["new_advisories"][0]["category"] == "lifespan"
    assert result["new_advisories"][0]["entity"] == "char_yuer"


def test_proposals_are_written_and_canon_bytes_stay_unchanged(project: Path) -> None:
    canon_file = _write_canon(project, _base_canon())
    before = canon_file.read_bytes()

    result = canon_delta(
        str(project),
        entities=[{"name": "新客"}],
        holder_claims=[{"item": "断魂刀", "holder": "char_qingyan", "from_chapter": 1}],
        exit_claims=[{"entity": "char_yuer", "exits_after_chapter": 2, "reason": "离城"}],
        timeline_claims=[{"before": "旧港会面", "after": "王城决战"}],
    )

    assert canon_file.read_bytes() == before
    draft = canon_store.read_derived(str(project), "proposals.json")
    assert draft is not None
    assert draft["entities"][-1] == result["proposals"]["new_entities"][0]
    assert draft["invariants"]["single_holder"] == result["proposals"]["holder_claims"]
    assert draft["invariants"]["lifespan"] == result["proposals"]["exit_claims"]
    assert draft["invariants"]["timeline_order"] == result["proposals"]["timeline_claims"]


def test_empty_arguments_return_honest_no_proposal_summary(project: Path) -> None:
    canon_file = _write_canon(project, _base_canon())
    before = canon_file.read_bytes()

    result = canon_delta(
        str(project),
        entities=[],
        holder_claims=[],
        exit_claims=[],
        timeline_claims=[],
    )

    assert all(not items for items in result["proposals"].values())
    assert result["alias_conflicts"] == []
    assert result["new_conflicts"] == []
    assert result["new_advisories"] == []
    assert "没有 canon 事实提议" in result["summary"]
    assert canon_file.read_bytes() == before


def test_missing_presence_cache_is_rebuilt(project: Path) -> None:
    _write_canon(project, _base_canon())
    assert canon_store.read_derived(str(project), "presence.json") is None

    canon_delta(str(project))

    presence = canon_store.read_derived(str(project), "presence.json")
    assert presence is not None
    assert presence["chapter_count"] == 2
    assert presence["scanned_files"] == 2


def test_writeback_invalidation_then_delta_rebuilds_presence_from_new_manuscript(
    project: Path,
) -> None:
    """D04：写回落盘使 presence.json 失效（Native 侧删除）后，canon_delta 必须从新正文重建。

    模拟链：presence 已缓存（旧正文 2 章）→ 作者接受补丁把第 02 章改写并新增第 03 章 →
    Native 写回删除 presence.json → 下一次 canon_delta 消费方读到 None 时按新正文重扫。
    """
    _write_canon(project, _base_canon())
    canon_delta(str(project))
    stale = canon_store.read_derived(str(project), "presence.json")
    assert stale is not None
    assert stale["chapter_count"] == 2

    (project / "正文" / "第02章.md").write_text("月儿把旧港让给了青岩。\n", encoding="utf-8")
    (project / "正文" / "第03章.md").write_text("新客走进旧港。\n", encoding="utf-8")
    # Native 写回成功后的统一失效：可弃缓存删除，缺失即重建。
    (project / ".storyforge" / "canon" / "derived" / "presence.json").unlink()

    canon_delta(str(project))

    rebuilt = canon_store.read_derived(str(project), "presence.json")
    assert rebuilt is not None
    assert rebuilt["chapter_count"] == 3
    assert rebuilt["scanned_files"] == 3


def test_derived_whitelist_still_rejects_unlisted_names(project: Path) -> None:
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.write_derived(str(project), "draft.json", {})


@pytest.mark.parametrize("argument,claim,invariant", [
    ("entities", {"name": "新客"}, None),
    ("holder_claims", {"item": "刀", "holder": "char_qingyan"}, "single_holder"),
    ("exit_claims", {"entity": "char_qingyan", "exits_after_chapter": 2}, "lifespan"),
    ("timeline_claims", {"before": "旧港", "after": "决战"}, "timeline_order"),
    ("promise_claims", {"title": "旧债", "planted_chapter": 1}, "promises"),
])
@pytest.mark.parametrize("assertion_type", ["author_setting", "text_observation", "model_inference", "unknown"])
def test_assertion_metadata_survives_draft_pending_and_author_roundtrip(project: Path, argument, claim, invariant, assertion_type) -> None:
    from app.domains.agent_runs.canon_delta import read_pending_proposals

    canon_file = _write_canon(project, _base_canon())
    original = canon_file.read_bytes()
    metadata = {"assertion_type": assertion_type, "evidence": [{"path": "正文/第01章.md", "start_line": 1, "end_line": 1, "quote": "青岩握着断魂刀。"}]}
    supplied = {**claim, **metadata}
    result = canon_delta(str(project), **{argument: [supplied]})
    proposed = result["proposals"]["new_entities" if argument == "entities" else argument][0]
    for key, value in metadata.items():
        assert proposed[key] == value
    canon_delta(str(project), **{argument: [supplied]})
    canon_delta(str(project), timeline_claims=[{"before": "a", "after": "b"}])
    pending = read_pending_proposals(str(project))
    entries = pending["new_entities"] if invariant is None else pending["new_invariants"][invariant]
    assert entries.count(proposed) == 1
    draft = canon_store.read_derived(str(project), "proposals.json")
    persisted = draft["entities"][-1] if invariant is None else draft["invariants"][invariant][0]
    assert persisted == proposed
    assert canon_file.read_bytes() == original
    # Simulate the existing author-owned JSON merge/write; no backend declaration write.
    _write_canon(project, draft)
    assert canon_store.read_canon(str(project)) == draft
    assert read_pending_proposals(str(project))["pending_count"] == 0


def test_known_entity_result_preserves_evidence_without_overwriting_author(project: Path) -> None:
    path = _write_canon(project, _base_canon())
    before = path.read_bytes()
    metadata = {"assertion_type": "text_observation", "evidence": [{"quote": "青岩握着断魂刀。"}]}
    result = canon_delta(str(project), entities=[{"name": "青岩", **metadata}])
    assert result["proposals"]["known_entities"][0] == {"name": "青岩", "aliases": [], "matched_id": "char_qingyan", **metadata}
    assert path.read_bytes() == before


@pytest.mark.parametrize("metadata", [
    {"assertion_type": "certain"}, {"assertion_type": []}, {"evidence": None},
    {"evidence": ["not an object"]}, {"evidence": [{"quote": " "}]},
    {"evidence": [{"quote": "q", "path": "../escape.md"}]},
    {"evidence": [{"quote": "q", "path": "C:\\escape.md"}]},
    {"evidence": [{"quote": "q", "path": "/escape.md"}]},
    {"evidence": [{"quote": "q", "start_line": 1}]},
    {"evidence": [{"quote": "q", "path": "a.md", "start_line": True}]},
    {"evidence": [{"quote": "q", "path": "a.md", "end_line": 2}]},
    {"evidence": [{"quote": "q", "path": "a.md", "start_line": 2, "end_line": 1}]},
])
def test_invalid_assertion_metadata_fails_before_any_write(project: Path, metadata) -> None:
    with pytest.raises(FsToolError):
        canon_delta(str(project), holder_claims=[{"item": "刀", "holder": "青岩", **metadata}])
    assert not (project / ".storyforge/canon").exists()


def test_distinct_evidence_and_type_are_not_silently_overwritten(project: Path) -> None:
    claims = [
        {"item": "刀", "holder": "青岩", "assertion_type": "model_inference", "evidence": [{"quote": "似乎持刀。"}]},
        {"item": "刀", "holder": "青岩", "assertion_type": "text_observation", "evidence": [{"quote": "握着刀。"}]},
    ]
    for claim in claims:
        canon_delta(str(project), holder_claims=[claim])
    draft = canon_store.read_derived(str(project), "proposals.json")
    assert draft["invariants"]["single_holder"] == claims


def test_legacy_metadata_absent_and_explicit_empty_evidence_are_not_fabricated(project: Path) -> None:
    result = canon_delta(str(project), holder_claims=[{"item": "刀", "holder": "青岩", "evidence": []}])
    assert result["proposals"]["holder_claims"] == [{"item": "刀", "holder": "青岩", "evidence": []}]


def test_canon_tool_schemas_expose_metadata_for_each_proposal_category() -> None:
    from app.domains.agent_runs.tooling import list_loop_tool_specs

    spec = next(spec for spec in list_loop_tool_specs() if spec.name == "project.canon_delta")
    properties = spec.loop_schema.parameters["properties"]
    for category in ("entities", "holder_claims", "exit_claims", "timeline_claims", "promise_claims"):
        fields = properties[category]["items"]["properties"]
        assert set(fields["assertion_type"]["enum"]) == {"author_setting", "text_observation", "model_inference", "unknown"}
        evidence = fields["evidence"]["items"]
        assert evidence["required"] == ["quote"]
        assert set(evidence["properties"]) == {"quote", "path", "start_line", "end_line"}


def test_evidence_display_is_bounded_but_persisted_quotes_remain_complete(project: Path) -> None:
    from app.domains.agent_runs.canon_assertions import render_assertion_metadata

    evidence = [{"quote": "正文引文" * 200, "path": "正文/第01章.md"} for _ in range(3)]
    result = canon_delta(str(project), holder_claims=[{"item": "刀", "holder": "青岩", "evidence": evidence}])
    entry = result["proposals"]["holder_claims"][0]
    assert entry["evidence"] == evidence
    display = render_assertion_metadata(entry)
    assert "未核验" in display and "另 1 条依据未展开" in display
    assert len(display) < 500
    assert canon_store.read_derived(str(project), "proposals.json")["invariants"]["single_holder"][0]["evidence"] == evidence


@pytest.mark.parametrize("same_batch", [True, False])
def test_repeated_new_entity_cannot_silently_discard_different_provenance(project: Path, same_batch: bool) -> None:
    first = {"name": "新客", "assertion_type": "model_inference", "evidence": [{"quote": "第一份依据"}]}
    second = {"name": "新客", "assertion_type": "model_inference", "evidence": [{"quote": "另一份依据"}]}
    if not same_batch:
        canon_delta(str(project), entities=[first])
    before = canon_store.read_derived(str(project), "proposals.json")
    with pytest.raises(FsToolError, match="整合为一条实体提案"):
        canon_delta(str(project), entities=[first, second] if same_batch else [second])
    assert canon_store.read_derived(str(project), "proposals.json") == before


def test_metadata_free_pending_entity_can_gain_evidence_and_legacy_calls_do_not_erase_it(project: Path) -> None:
    canon_delta(str(project), entities=[{"name": "新客"}])
    metadata = {"assertion_type": "model_inference", "evidence": [{"quote": "可能是新客。"}]}
    canon_delta(str(project), entities=[{"name": "新客", **metadata}])
    canon_delta(str(project), entities=[{"name": "新客"}])
    entity = canon_store.read_derived(str(project), "proposals.json")["entities"][0]
    assert entity["evidence"] == metadata["evidence"]
    assert entity["assertion_type"] == "model_inference"
