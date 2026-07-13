"""项目级一致性观察扫描：机械统计，不下结论。

Q1-Q8 一致性能力工具化的第一步：只产出可复核的观察信号——词条出现分布
（含缺席）、时间标记罗列、跨文件重复子句——由 LLM 结合原文与设定自行推理
结论。本模块不做任何「冲突 / 违规」判定，避免未验证误报率的硬判定误导作者。
路径边界与只读约束复用 fs_tools（同包私有复用，先例见 style_fingerprint）。
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from app.domains.agent_runs.fs_tools import (
    FsToolError,
)
from app.domains.agent_runs.fs_tools import (
    iter_project_files as _iter_project_files,
)
from app.domains.agent_runs.fs_tools import (
    read_text_file as _read_text,
)
from app.domains.agent_runs.fs_tools import (
    resolve_project_root as _resolve_root,
)
from app.domains.agent_runs.fs_tools import (
    resolve_scoped_path as _resolve_scoped,
)

_MAX_TERMS = 30
_MAX_FILES = 2_000
_MAX_FILE_BYTES = 512_000
_MAX_TIME_MARKERS = 80
_MAX_REPEATED_CLAUSES = 20
_MAX_TERM_FILE_ENTRIES = 50
_MIN_CLAUSE_CHARS = 6
_MIN_CLAUSE_REPEATS = 3
_CLAUSE_MAX_CHARS = 40
_EXCERPT_MAX_CHARS = 120

# 常见中文叙事时间表达：只做标记罗列，不解析先后关系。
_TIME_MARKER_PATTERN = re.compile(
    r"(?:第[零一二三四五六七八九十百千0-9]+[天日夜年月更]"
    r"|[一二三四五六七八九十百0-9]+(?:天|日|年|月|个月|时辰)(?:前|后|之前|之后)"
    r"|次日|翌日|当夜|当晚|昨夜|昨日|今晨|今夜|前夜|三更|五更|半夜"
    r"|清晨|黎明|拂晓|破晓|晌午|正午|午后|傍晚|黄昏|入夜|深夜|夜里"
    r"|开春|入夏|入秋|入冬|年关|岁末|开年"
    r"|[春夏秋冬][天日季末初]"
    r")"
)

_CLAUSE_SPLIT_PATTERN = re.compile(r"[，。！？；：、\n\s“”「」『』…—]+")


def _normalized_terms(terms: list[str] | None) -> tuple[list[str], bool]:
    if not terms:
        return [], False
    seen: list[str] = []
    for term in terms:
        if not isinstance(term, str):
            continue
        cleaned = term.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen[:_MAX_TERMS], len(seen) > _MAX_TERMS


def consistency_scan(
    project_root: str,
    terms: list[str] | None = None,
    *,
    subpath: str | None = None,
    glob: str = "*.md",
) -> dict[str, Any]:
    """按阅读顺序（路径序）扫描项目文本，返回一致性观察信号。"""

    root = _resolve_root(project_root)
    scope = _resolve_scoped(root, subpath)
    if not scope.is_dir():
        raise FsToolError(f"不是目录：{subpath}")

    tracked_terms, terms_truncated = _normalized_terms(terms)

    files: list[tuple[str, str]] = []
    files_truncated = False
    for path in _iter_project_files(root):
        if scope != root and scope not in path.parents:
            continue
        if not path.match(glob):
            continue
        if len(files) >= _MAX_FILES:
            files_truncated = True
            break
        try:
            content = _read_text(path, max_bytes=_MAX_FILE_BYTES)
        except FsToolError:
            continue
        files.append((path.relative_to(root).as_posix(), content))

    term_stats: dict[str, list[dict[str, Any]]] = {term: [] for term in tracked_terms}
    time_markers: list[dict[str, Any]] = []
    time_markers_truncated = False
    clause_counts: dict[str, int] = defaultdict(int)
    clause_files: dict[str, list[str]] = defaultdict(list)

    for relative, content in files:
        lines = content.split("\n")

        for term in tracked_terms:
            count = 0
            first_line: int | None = None
            last_line: int | None = None
            for line_number, line in enumerate(lines, start=1):
                hits = line.count(term)
                if hits:
                    count += hits
                    if first_line is None:
                        first_line = line_number
                    last_line = line_number
            if count:
                term_stats[term].append(
                    {"path": relative, "count": count, "first_line": first_line, "last_line": last_line}
                )

        for line_number, line in enumerate(lines, start=1):
            if time_markers_truncated:
                break
            for marker in _TIME_MARKER_PATTERN.findall(line):
                if len(time_markers) >= _MAX_TIME_MARKERS:
                    time_markers_truncated = True
                    break
                time_markers.append(
                    {
                        "path": relative,
                        "line": line_number,
                        "marker": marker,
                        "excerpt": line.strip()[:_EXCERPT_MAX_CHARS],
                    }
                )

        for clause in _CLAUSE_SPLIT_PATTERN.split(content):
            cleaned = clause.strip()
            if len(cleaned) < _MIN_CLAUSE_CHARS:
                continue
            clause_counts[cleaned] += 1
            if relative not in clause_files[cleaned]:
                clause_files[cleaned].append(relative)

    term_occurrences = [
        {
            "term": term,
            "total_count": sum(entry["count"] for entry in entries),
            "missing": not entries,
            "files": entries[:_MAX_TERM_FILE_ENTRIES],
        }
        for term, entries in term_stats.items()
    ]

    repeated_clauses = [
        {"clause": clause[:_CLAUSE_MAX_CHARS], "count": count, "files": clause_files[clause][:5]}
        for clause, count in sorted(clause_counts.items(), key=lambda item: (-item[1], item[0]))
        if count >= _MIN_CLAUSE_REPEATS
    ][:_MAX_REPEATED_CLAUSES]

    return {
        "scanned_files": len(files),
        "files_truncated": files_truncated,
        "term_occurrences": term_occurrences,
        "terms_truncated": terms_truncated,
        "time_markers": time_markers,
        "time_markers_truncated": time_markers_truncated,
        "repeated_clauses": repeated_clauses,
    }
