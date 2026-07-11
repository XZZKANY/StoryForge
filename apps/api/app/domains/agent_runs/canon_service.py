"""Canon 投影：确定性重建在场 + 闸门 + dossier，落派生缓存（无 LLM，无 key）。

从 runtime._project_canon 抽出的可复用核心：既供 LLM 循环内工具 project.canon 调用，
也供确定性触发（IDE 命令 canon.refresh）直接调用——后者不依赖 LLM 决定，保证含
人物/设定/正文的项目每次触发都写出 .storyforge/canon/derived/dossier.md。

红线不变：只写派生缓存（presence.json / report.json / dossier.md），绝不碰手稿或
canon.json（缺失时仅脚手架空模板确立格式）。
"""

from __future__ import annotations

from typing import Any

from app.domains.agent_runs import canon_dossier, canon_gate, canon_rebuild, canon_store


def run_canon_projection(
    project_root: str,
    *,
    glob: str = "*.md",
    refresh: bool = True,
) -> dict[str, Any]:
    """重建在场分布、跑不变量闸门、写出 dossier，返回参考信号 output（非质量判定）。

    refresh=False 时优先复用已落盘的 presence.json 缓存；否则从正文重扫并覆盖。
    dossier.md 每次调用都写出——canon.json 无声明时也写一份诚实空态卡。
    """

    # 红线例外：只写派生缓存（非手稿）；canon.json 缺失时脚手架空模板确立格式。
    scaffolded = canon_store.scaffold_canon_if_missing(project_root)
    canon = canon_store.read_canon(project_root)
    entities = [item for item in (canon.get("entities") or []) if isinstance(item, dict)]

    cached = None if refresh else canon_store.read_derived(project_root, "presence.json")
    if cached is not None:
        presence = cached
    else:
        presence = canon_rebuild.rebuild_presence(project_root, entities, glob=glob)
        canon_store.write_derived(project_root, "presence.json", presence)

    gate = canon_gate.check(canon, presence)
    report = {
        "conflicts": gate["conflicts"],
        "advisories": gate["advisories"],
        "checked_invariants": gate["checked_invariants"],
        "entity_count": len(entities),
        "scaffolded_canon": scaffolded,
    }
    canon_store.write_derived(project_root, "report.json", report)

    # 富 view：每实体确定性事实投影落成人可读派生缓存 dossier.md（summary-only 回 LLM）。
    dossiers = canon_dossier.build_dossiers(canon, presence)
    dossier_path = canon_store.write_derived_text(
        project_root, "dossier.md", canon_dossier.render_dossiers_markdown(dossiers)
    )

    has_declarations = bool(gate["checked_invariants"])
    note = (
        "canon.json 尚无不变量声明，已建立空格式骨架；在场缓存已重建但暂无可校验项，"
        "请在 .storyforge/canon/canon.json 声明实体与不变量后再查。"
        if not has_declarations
        else "结果为参考信号：硬矛盾（blocking）是声明内部结构冲突，advisory 须抽读原文核实。"
    )
    return {
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
