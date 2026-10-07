"""Canon 投影：确定性重建在场 + 闸门 + dossier，落派生缓存（无 LLM，无 key）。

从 runtime._project_canon 抽出的可复用核心：既供 LLM 循环内工具 project.canon 调用，
也供确定性触发（IDE 命令 canon.refresh）直接调用——后者不依赖 LLM 决定，保证含
人物/设定/正文的项目可生成事实卡；来源版本可确认时才发布派生缓存。

红线不变：只写派生缓存（presence.json / report.json / dossier.md），绝不碰手稿或
canon.json（缺失时仅脚手架空模板确立格式）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.domains.agent_runs import canon_dossier, canon_gate, canon_rebuild, canon_store
from app.domains.agent_runs.canon_cache_freshness import UNCACHED_SCAN_NOTE


@dataclass(frozen=True)
class CanonProjectionResult:
    output: dict[str, Any]
    canon: dict[str, Any]
    presence: dict[str, Any]
    source_revision: str | None


def build_canon_projection(
    project_root: str,
    *,
    glob: str = "*.md",
    refresh: bool = True,
) -> CanonProjectionResult:
    """重建在场分布、跑不变量闸门、写出 dossier，返回参考信号 output（非质量判定）。

    refresh=False 时优先复用已落盘的 presence.json 缓存；否则从正文重扫并覆盖。
    来源版本无法确认时仍直接扫描，但不复用或发布派生缓存。
    """

    # 红线例外：只写派生缓存（非手稿）；canon.json 缺失时脚手架空模板确立格式。
    scaffolded = canon_store.scaffold_canon_if_missing(project_root)
    source_revision = canon_store.capture_source_revision(project_root)
    canon = canon_store.read_canon(project_root)
    entities = [item for item in (canon.get("entities") or []) if isinstance(item, dict)]

    cached = (
        None if refresh or source_revision is None
        else canon_store.read_derived(project_root, "presence.json")
    )
    if cached is not None:
        presence = cached
    else:
        presence = canon_rebuild.rebuild_presence(project_root, entities, glob=glob)
        if source_revision is not None:
            canon_store.write_derived(project_root, "presence.json", presence, source_revision=source_revision)

    gate = canon_gate.check(canon, presence)
    report = {
        "conflicts": gate["conflicts"],
        "advisories": gate["advisories"],
        "checked_invariants": gate["checked_invariants"],
        "entity_count": len(entities),
        "scaffolded_canon": scaffolded,
    }
    if source_revision is not None:
        canon_store.write_derived(project_root, "report.json", report, source_revision=source_revision)

    # 富 view：每实体确定性事实投影落成人可读派生缓存 dossier.md（summary-only 回 LLM）。
    dossiers = canon_dossier.build_dossiers(canon, presence)
    dossier_path = None
    if source_revision is not None:
        dossier_path = canon_store.write_derived_text(
            project_root, "dossier.md", canon_dossier.render_dossiers_markdown(dossiers),
            source_revision=source_revision,
        )

    has_declarations = bool(gate["checked_invariants"])
    note = (
        "canon.json 尚无不变量声明，已建立空格式骨架；在场分布已扫描但暂无可校验项，"
        "请在 .storyforge/canon/canon.json 声明实体与不变量后再查。"
        if not has_declarations
        else "结果为参考信号：硬矛盾（blocking）是声明内部结构冲突，advisory 须抽读原文核实。"
    )
    if source_revision is None:
        note += UNCACHED_SCAN_NOTE
    output = {
        "cache_status": "uncached_unverified" if source_revision is None else "published",
        "entity_count": len(entities),
        "checked_invariants": gate["checked_invariants"],
        "conflicts": gate["conflicts"],
        "advisories": gate["advisories"],
        "conflict_count": gate["conflict_count"],
        "advisory_count": gate["advisory_count"],
        "presence_summary": {
            "chapter_count": presence.get("chapter_count"),
            "scanned_files": presence.get("scanned_files"),
            "terms_truncated": presence.get("terms_truncated"),
            "missing_entities": [
                e.get("id") for e in (presence.get("entities") or []) if e.get("missing")
            ],
        },
        "scaffolded_canon": scaffolded,
        "dossier": {
            "entity_count": len(dossiers),
            "path": dossier_path,
            "missing_entities": [d["id"] for d in dossiers if d["appearance"]["missing"]],
        },
        "note": note,
    }
    return CanonProjectionResult(
        output=output, canon=canon, presence=presence, source_revision=source_revision
    )


def run_canon_projection(
    project_root: str, *, glob: str = "*.md", refresh: bool = True
) -> dict[str, Any]:
    return build_canon_projection(project_root, glob=glob, refresh=refresh).output
