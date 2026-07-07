"""每实体 canon dossier：确定性事实投影 + provenance（纯函数，无 LLM）。

现代防漂移形状的「富 view」骨架：把作者声明（canon.json）与从正文重建的在场分布
（presence）按实体归并成一份人可读事实卡——身份、别名、出场跨度与章分布、绑定的
声明式不变量（唯一持有 / 生命期）、provenance（出现文件+行号，供抽读核实）。

本刀只做**确定性事实投影**：全部字段可从 canon + presence 机械导出，无 LLM 推断。
自然语言侧写 / 模糊态策展 / LLM 辅助抽取留后续 slice。dossier 是可弃派生缓存，
从正文重建自愈，不是作者手稿，也不回写 canon.json。
"""

from __future__ import annotations

from typing import Any

# provenance 每实体最多列这么多处出现，避免长书把派生文件撑爆（超出只留计数）。
_MAX_PROVENANCE = 20


def _presence_by_id(presence: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        entry["id"]: entry
        for entry in (presence.get("entities") or [])
        if isinstance(entry, dict) and entry.get("id") is not None
    }


def _entity_holdings(entity_id: str, single_holder: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """该实体作为 holder 声明持有的 item + 章窗。"""

    holdings: list[dict[str, Any]] = []
    for entry in single_holder:
        if entry.get("holder") != entity_id:
            continue
        item = entry.get("item")
        if not isinstance(item, str) or not item.strip():
            continue
        holdings.append(
            {
                "item": item,
                "from_chapter": entry.get("from_chapter"),
                "to_chapter": entry.get("to_chapter"),
            }
        )
    return holdings


def _entity_lifespan(entity_id: str, lifespan: list[dict[str, Any]]) -> dict[str, Any] | None:
    for entry in lifespan:
        if entry.get("entity") != entity_id:
            continue
        exits_after = entry.get("exits_after_chapter")
        if isinstance(exits_after, int) and not isinstance(exits_after, bool):
            return {"exits_after_chapter": exits_after, "reason": entry.get("reason")}
    return None


def _provenance(record: dict[str, Any] | None) -> list[dict[str, Any]]:
    if record is None:
        return []
    prov: list[dict[str, Any]] = []
    for occ in record.get("occurrences") or []:
        prov.append(
            {
                "path": occ.get("path"),
                "chapter": occ.get("chapter"),
                "first_line": occ.get("first_line"),
                "count": occ.get("count"),
            }
        )
    return prov[:_MAX_PROVENANCE]


def build_dossiers(canon: dict[str, Any], presence: dict[str, Any]) -> list[dict[str, Any]]:
    """按实体归并 canon 声明 + presence 分布成事实 dossier 列表（保 canon.entities 序）。"""

    invariants = canon.get("invariants") or {}
    single_holder = [e for e in (invariants.get("single_holder") or []) if isinstance(e, dict)]
    lifespan = [e for e in (invariants.get("lifespan") or []) if isinstance(e, dict)]
    by_id = _presence_by_id(presence)

    dossiers: list[dict[str, Any]] = []
    for entity in canon.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        if not isinstance(entity_id, str) or not entity_id.strip():
            continue
        record = by_id.get(entity_id)
        prov = _provenance(record)
        dossiers.append(
            {
                "id": entity_id,
                "canonical_name": entity.get("canonical_name"),
                "kind": entity.get("kind"),
                "aliases": [a for a in (entity.get("aliases") or []) if isinstance(a, str)],
                "appearance": {
                    "missing": record.get("missing", True) if record else True,
                    "total_count": record.get("total_count", 0) if record else 0,
                    "first_chapter": record.get("first_chapter") if record else None,
                    "last_chapter": record.get("last_chapter") if record else None,
                },
                "holdings": _entity_holdings(entity_id, single_holder),
                "lifespan": _entity_lifespan(entity_id, lifespan),
                "provenance": prov,
                "provenance_truncated": bool(record)
                and len(record.get("occurrences") or []) > _MAX_PROVENANCE,
            }
        )
    return dossiers


def _chapter_span(appearance: dict[str, Any]) -> str:
    first, last = appearance.get("first_chapter"), appearance.get("last_chapter")
    if first is None:
        return "未在正文出现"
    if first == last:
        return f"第 {first} 章"
    return f"第 {first}–{last} 章"


def _render_one(dossier: dict[str, Any]) -> list[str]:
    name = dossier.get("canonical_name") or dossier.get("id")
    kind = dossier.get("kind")
    heading = f"## {name}" + (f"（{kind}）" if isinstance(kind, str) and kind.strip() else "")
    lines = [heading, ""]

    aliases = dossier.get("aliases") or []
    if aliases:
        lines.append(f"- 别名：{'、'.join(aliases)}")

    appearance = dossier.get("appearance") or {}
    if appearance.get("missing"):
        lines.append("- 出场：未在正文检出表面形（可能未登场或表面形与正文不符）")
    else:
        lines.append(
            f"- 出场：{_chapter_span(appearance)}，共 {appearance.get('total_count', 0)} 处"
        )

    for holding in dossier.get("holdings") or []:
        to_chapter = holding.get("to_chapter")
        window = f"第 {holding.get('from_chapter')} 章起" + (
            f"至第 {to_chapter} 章" if to_chapter is not None else "（未声明终止）"
        )
        lines.append(f"- 持有：{holding.get('item')}（{window}）")

    lifespan = dossier.get("lifespan")
    if lifespan:
        reason = lifespan.get("reason")
        reason_hint = f"，原因：{reason}" if isinstance(reason, str) and reason.strip() else ""
        lines.append(f"- 生命期：声明第 {lifespan.get('exits_after_chapter')} 章后退场{reason_hint}")

    prov = dossier.get("provenance") or []
    if prov:
        lines.append("- provenance：")
        for occ in prov:
            chapter = occ.get("chapter")
            chapter_hint = f"第 {chapter} 章 " if chapter is not None else ""
            line_hint = f":{occ.get('first_line')}" if occ.get("first_line") is not None else ""
            lines.append(f"  - {chapter_hint}`{occ.get('path')}{line_hint}`（{occ.get('count')} 处）")
        if dossier.get("provenance_truncated"):
            lines.append(f"  - …（出现处超过 {_MAX_PROVENANCE}，仅列前 {_MAX_PROVENANCE} 处）")

    lines.append("")
    return lines


def render_dossiers_markdown(dossiers: list[dict[str, Any]]) -> str:
    """把 dossier 列表渲染成一份聚合 markdown（可弃派生缓存，非作者手稿）。"""

    out = [
        "# Canon Dossier（派生缓存，勿手改）",
        "",
        "> 本文件由 project.canon 从 canon.json 声明 + 正文在场分布确定性重建，",
        "> 是可弃缓存（删除后下次调用自愈），不是作者手稿。要改事实请改 canon.json。",
        "",
    ]
    if not dossiers:
        out.append("_canon.json 尚无实体声明。_")
        out.append("")
        return "\n".join(out)
    for dossier in dossiers:
        out.extend(_render_one(dossier))
    return "\n".join(out)
