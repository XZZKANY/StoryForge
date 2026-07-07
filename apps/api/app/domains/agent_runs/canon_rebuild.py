"""从手稿正文重建实体在场分布缓存（确定性，无 LLM）。

现代防漂移形状：正文是唯一真值源，presence 是从正文可重建的可弃缓存——
漏更下次 rebuild 自愈，胜过 event-source 的永久偏。逐行 term 统计复用
consistency_scan（最大化复用、不另造扫描器），另建 path→章序映射供生命期闸使用。
章序按路径序推断（_iter_project_files 排序 = 阅读序），slice 1 不解析章内绝对时间。
"""

from __future__ import annotations

from typing import Any

from app.domains.agent_runs.consistency_scan import consistency_scan
from app.domains.agent_runs.fs_tools import _iter_project_files, _resolve_root


def _chapter_ordinals(project_root: str, glob: str) -> dict[str, int]:
    """按 _iter_project_files 的路径序给每个匹配正文文件编 1-based 章序（阅读序）。"""

    root = _resolve_root(project_root)
    ordinals: dict[str, int] = {}
    index = 0
    for path in _iter_project_files(root):
        if not path.match(glob):
            continue
        index += 1
        ordinals[path.relative_to(root).as_posix()] = index
    return ordinals


def _entity_surface_forms(entity: dict[str, Any]) -> list[str]:
    forms: list[str] = []
    for value in (entity.get("canonical_name"), *(entity.get("aliases") or [])):
        if isinstance(value, str) and value.strip() and value.strip() not in forms:
            forms.append(value.strip())
    return forms


def rebuild_presence(
    project_root: str,
    entities: list[dict[str, Any]],
    *,
    glob: str = "*.md",
) -> dict[str, Any]:
    """扫正文，产出每个实体（canonical_name + aliases 表面形）的在场分布。

    正文经 _iter_project_files 天然跳过 .storyforge，canon 缓存不会自我污染。
    """

    ordinals = _chapter_ordinals(project_root, glob)

    all_forms: list[str] = []
    for entity in entities:
        for form in _entity_surface_forms(entity):
            if form not in all_forms:
                all_forms.append(form)

    scan = consistency_scan(project_root, all_forms, glob=glob) if all_forms else None
    term_index: dict[str, dict[str, Any]] = {}
    if scan is not None:
        term_index = {occ["term"]: occ for occ in scan["term_occurrences"]}

    presence_entities: list[dict[str, Any]] = []
    for entity in entities:
        forms = _entity_surface_forms(entity)
        per_path: dict[str, dict[str, Any]] = {}
        for form in forms:
            occ = term_index.get(form)
            if occ is None:
                continue
            for file_entry in occ["files"]:
                path = file_entry["path"]
                bucket = per_path.setdefault(
                    path,
                    {
                        "path": path,
                        "chapter": ordinals.get(path),
                        "count": 0,
                        "first_line": file_entry["first_line"],
                        "matched_forms": [],
                    },
                )
                bucket["count"] += file_entry["count"]
                if file_entry["first_line"] is not None and (
                    bucket["first_line"] is None or file_entry["first_line"] < bucket["first_line"]
                ):
                    bucket["first_line"] = file_entry["first_line"]
                if form not in bucket["matched_forms"]:
                    bucket["matched_forms"].append(form)

        occurrences = sorted(
            per_path.values(),
            key=lambda item: (item["chapter"] is None, item["chapter"] or 0, item["path"]),
        )
        chapters = [item["chapter"] for item in occurrences if item["chapter"] is not None]
        presence_entities.append(
            {
                "id": entity.get("id"),
                "canonical_name": entity.get("canonical_name"),
                "surface_forms": forms,
                "total_count": sum(item["count"] for item in occurrences),
                "missing": not occurrences,
                "first_chapter": min(chapters) if chapters else None,
                "last_chapter": max(chapters) if chapters else None,
                "occurrences": occurrences,
            }
        )

    return {
        "entities": presence_entities,
        "chapter_count": len(ordinals),
        "scanned_files": scan["scanned_files"] if scan is not None else 0,
        "terms_truncated": bool(scan["terms_truncated"]) if scan is not None else False,
    }
