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
        holder_claims=[
            {"item": "断魂刀", "holder": "char_yuer", "from_chapter": 5, "to_chapter": 8}
        ],
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


def test_derived_whitelist_still_rejects_unlisted_names(project: Path) -> None:
    with pytest.raises(FsToolError, match="不允许的派生缓存文件名"):
        canon_store.write_derived(str(project), "draft.json", {})
