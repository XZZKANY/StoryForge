"""确定性 canon 提案：归并实体与声明，输出差量风险并写派生草稿。"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha1
from typing import Any

from app.domains.agent_runs import canon_gate, canon_rebuild, canon_store
from app.domains.agent_runs.fs_tools import FsToolError


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FsToolError(f"{label} 必须是非空字符串。")
    return value.strip()


def _optional_text(value: object, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise FsToolError(f"{label} 必须是字符串。")
    return value.strip()


def _optional_int(entry: dict[str, Any], key: str, label: str) -> int | None:
    if key not in entry:
        return None
    value = entry[key]
    if not isinstance(value, int) or isinstance(value, bool):
        raise FsToolError(f"{label} 必须是整数。")
    return value


def _normalize_entities(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(entries or []):
        name = _required_text(entry.get("name"), f"entities[{index}].name")
        aliases_raw = entry.get("aliases", [])
        if not isinstance(aliases_raw, list) or any(not isinstance(item, str) for item in aliases_raw):
            raise FsToolError(f"entities[{index}].aliases 必须是字符串数组。")
        aliases: list[str] = []
        for raw in aliases_raw:
            alias = raw.strip()
            if alias and alias != name and alias not in aliases:
                aliases.append(alias)
        normalized.append({"name": name, "aliases": aliases})
    return normalized


def _normalize_holder_claims(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(entries or []):
        claim: dict[str, Any] = {
            "item": _required_text(entry.get("item"), f"holder_claims[{index}].item"),
            "holder": _required_text(entry.get("holder"), f"holder_claims[{index}].holder"),
        }
        for key in ("from_chapter", "to_chapter"):
            value = _optional_int(entry, key, f"holder_claims[{index}].{key}")
            if value is not None:
                claim[key] = value
        normalized.append(claim)
    return normalized


def _normalize_exit_claims(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(entries or []):
        exits_after = _optional_int(
            entry,
            "exits_after_chapter",
            f"exit_claims[{index}].exits_after_chapter",
        )
        if exits_after is None:
            raise FsToolError(f"exit_claims[{index}].exits_after_chapter 必填。")
        claim: dict[str, Any] = {
            "entity": _required_text(entry.get("entity"), f"exit_claims[{index}].entity"),
            "exits_after_chapter": exits_after,
        }
        reason = _optional_text(entry.get("reason"), f"exit_claims[{index}].reason")
        if reason is not None:
            claim["reason"] = reason
        normalized.append(claim)
    return normalized


def _normalize_timeline_claims(entries: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    return [
        {
            "before": _required_text(entry.get("before"), f"timeline_claims[{index}].before"),
            "after": _required_text(entry.get("after"), f"timeline_claims[{index}].after"),
        }
        for index, entry in enumerate(entries or [])
    ]


def _surface_index(canon_entities: list[dict[str, Any]]) -> dict[str, set[str]]:
    index: dict[str, set[str]] = {}
    for entity in canon_entities:
        entity_id = entity.get("id")
        if not isinstance(entity_id, str) or not entity_id.strip():
            continue
        for surface in canon_rebuild.entity_surface_forms(entity):
            index.setdefault(surface, set()).add(entity_id.strip())
    return index


def _entity_id(name: str) -> str:
    return f"ent_{sha1(name.encode('utf-8')).hexdigest()[:8]}"


def _classify_entities(
    proposed: list[dict[str, Any]],
    canon_entities: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    surface_index = _surface_index(canon_entities)
    new_by_id: dict[str, dict[str, Any]] = {}
    known: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for entity in proposed:
        surfaces = [entity["name"], *entity["aliases"]]
        matched_ids = sorted(
            {
                entity_id
                for surface in surfaces
                for entity_id in surface_index.get(surface, set())
            }
        )
        if len(matched_ids) > 1:
            conflicts.append(
                {
                    "rule": "alias_conflict",
                    "severity": "advisory",
                    "detail": "同一提议实体的名称或别名命中多个既有实体，请作者核实身份归属。",
                    "snippet": "、".join(surfaces),
                    "matched_ids": matched_ids,
                }
            )
            known.append({**entity, "matched_ids": matched_ids})
            continue
        if matched_ids:
            known.append({**entity, "matched_id": matched_ids[0]})
            continue

        entity_id = _entity_id(entity["name"])
        existing = new_by_id.get(entity_id)
        if existing is None:
            new_by_id[entity_id] = {
                "id": entity_id,
                "canonical_name": entity["name"],
                "aliases": list(entity["aliases"]),
            }
            continue
        for alias in entity["aliases"]:
            if alias not in existing["aliases"]:
                existing["aliases"].append(alias)

    return list(new_by_id.values()), known, conflicts


def _append_invariant_claims(
    merged: dict[str, Any],
    holder_claims: list[dict[str, Any]],
    exit_claims: list[dict[str, Any]],
    timeline_claims: list[dict[str, Any]],
) -> None:
    invariants = merged.setdefault("invariants", {})
    if not isinstance(invariants, dict):
        raise FsToolError("canon.json invariants 必须是 JSON 对象。")
    for key, claims in (
        ("single_holder", holder_claims),
        ("lifespan", exit_claims),
        ("timeline_order", timeline_claims),
    ):
        if not claims:
            continue
        existing = invariants.setdefault(key, [])
        if not isinstance(existing, list):
            raise FsToolError(f"canon.json invariants.{key} 必须是数组。")
        existing.extend(deepcopy(claims))


def _new_gate_issues(
    baseline: dict[str, Any],
    merged: dict[str, Any],
    key: str,
) -> list[dict[str, Any]]:
    baseline_ids = {
        issue.get("id")
        for issue in baseline.get(key, [])
        if isinstance(issue, dict) and issue.get("id") is not None
    }
    return [
        issue
        for issue in merged.get(key, [])
        if isinstance(issue, dict) and issue.get("id") not in baseline_ids
    ]


def _summary(
    proposals: dict[str, list[dict[str, Any]]],
    alias_conflicts: list[dict[str, Any]],
    new_conflicts: list[dict[str, Any]],
    new_advisories: list[dict[str, Any]],
) -> str:
    proposal_count = sum(len(items) for items in proposals.values())
    if proposal_count == 0 and not alias_conflicts:
        return "本章没有 canon 事实提议；canon.json 未改动。"
    return (
        f"canon_delta 生成 {proposal_count} 条提议，发现 {len(alias_conflicts)} 个别名冲突、"
        f"{len(new_conflicts)} 个新增硬矛盾、{len(new_advisories)} 个新增 advisory；"
        "canon.json 未改动，请审阅 proposals.json 草稿。"
    )


def canon_delta(
    project_root: str,
    *,
    entities: list[dict[str, Any]] | None = None,
    holder_claims: list[dict[str, Any]] | None = None,
    exit_claims: list[dict[str, Any]] | None = None,
    timeline_claims: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """把结构化正文观察值合并成可审阅 canon 草稿，不写回作者 canon。"""

    normalized_entities = _normalize_entities(entities)
    normalized_holders = _normalize_holder_claims(holder_claims)
    normalized_exits = _normalize_exit_claims(exit_claims)
    normalized_timeline = _normalize_timeline_claims(timeline_claims)

    canon_store.scaffold_canon_if_missing(project_root)
    canon = canon_store.read_canon(project_root)
    canon_entities = canon.get("entities") or []
    if not isinstance(canon_entities, list) or any(not isinstance(item, dict) for item in canon_entities):
        raise FsToolError("canon.json entities 必须是对象数组。")

    presence = canon_store.read_derived(project_root, "presence.json")
    if presence is None:
        presence = canon_rebuild.rebuild_presence(project_root, canon_entities)
        canon_store.write_derived(project_root, "presence.json", presence)

    new_entities, known_entities, alias_conflicts = _classify_entities(
        normalized_entities,
        canon_entities,
    )
    proposals = {
        "new_entities": new_entities,
        "known_entities": known_entities,
        "holder_claims": normalized_holders,
        "exit_claims": normalized_exits,
        "timeline_claims": normalized_timeline,
    }

    baseline_gate = canon_gate.check(canon, presence)
    merged_canon = deepcopy(canon)
    merged_entities = merged_canon.setdefault("entities", [])
    if not isinstance(merged_entities, list):
        raise FsToolError("canon.json entities 必须是数组。")
    merged_entities.extend(deepcopy(new_entities))
    _append_invariant_claims(
        merged_canon,
        normalized_holders,
        normalized_exits,
        normalized_timeline,
    )
    merged_gate = canon_gate.check(merged_canon, presence)
    new_conflicts = _new_gate_issues(baseline_gate, merged_gate, "conflicts")
    new_advisories = _new_gate_issues(baseline_gate, merged_gate, "advisories")

    canon_store.write_derived(project_root, "proposals.json", merged_canon)
    return {
        "proposals": proposals,
        "alias_conflicts": alias_conflicts,
        "new_conflicts": new_conflicts,
        "new_advisories": new_advisories,
        "summary": _summary(proposals, alias_conflicts, new_conflicts, new_advisories),
    }
