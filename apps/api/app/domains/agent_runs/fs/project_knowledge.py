from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs.fs.knowledge_entries import KnowledgeEntry, parse_knowledge_markdown
from app.domains.agent_runs.fs_tools import (
    FsToolError,
    normalize_project_relative_path,
    read_text_file,
    resolve_project_root,
    resolve_scoped_path,
)

PROJECT_KNOWLEDGE_MAX_FILE_BYTES = 512 * 1024
PROJECT_KNOWLEDGE_MAX_CANDIDATES = 200
PROJECT_KNOWLEDGE_READ_LIMIT_DEFAULT = 20_000
PROJECT_KNOWLEDGE_READ_LIMIT_MAX = 200_000
PROJECT_KNOWLEDGE_SEARCH_MAX_MATCHES = 50
PROJECT_KNOWLEDGE_SEARCH_MAX_FILES = 2_000

_ALLOWED_EXTENSIONS = frozenset({".md", ".markdown", ".txt", ".json", ".yaml", ".yml"})
_DIRECTORY_SOURCES = {
    "大纲": "outline",
    "outline": "outline",
    "outlines": "outline",
    "人物": "character",
    "角色": "character",
    "character": "character",
    "characters": "character",
    "设定": "setting",
    "世界观": "setting",
    "setting": "setting",
    "settings": "setting",
    "world": "setting",
    "worldbuilding": "setting",
    "时间线": "timeline",
    "timeline": "timeline",
    "timelines": "timeline",
    "chronology": "timeline",
    "伏笔": "foreshadowing",
    "foreshadowing": "foreshadowing",
    "foreshadows": "foreshadowing",
    "seeds": "foreshadowing",
    ".资料": "materials",
    "资料": "materials",
    "materials": "materials",
    "knowledge": "materials",
}
_STORYFORGE_FILES = {
    ".storyforge/book.json": "book_profile",
    ".storyforge/agent-instructions.md": "author_instructions",
    ".storyforge/serial-plan.json": "serial_plan",
    ".storyforge/canon/canon.json": "canon",
    ".storyforge/canon/hooks.json": "canon",
}
_BLOCKED_DIRECTORY_NAMES = frozenset(
    {
        "derived",
        "version",
        "versions",
        "cache",
        "caches",
        "log",
        "logs",
        "database",
        "databases",
        "db",
        "config",
        "configs",
    }
)
_SENSITIVE_NAME = re.compile(
    r"(?:^|[._-])(credential|credentials|secret|secrets|token|tokens|password|passwd|api[-_]?key|private[-_]?key)(?:[._-]|$)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class IndexedProjectKnowledgeEntry:
    relative_path: str
    entry: KnowledgeEntry


@dataclass(frozen=True)
class ProjectKnowledgeEntryIndex:
    entries: tuple[IndexedProjectKnowledgeEntry, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ProjectKnowledgeDocument:
    absolute_path: str
    relative_path: str
    source_type: str
    content: str


def project_knowledge_source_type(path: str) -> str | None:
    try:
        normalized = normalize_project_relative_path(path)
    except FsToolError:
        return None
    explicit = _STORYFORGE_FILES.get(normalized)
    if explicit:
        return explicit
    parts = PurePosixPath(normalized).parts
    if not parts:
        return None
    first = parts[0]
    source = _DIRECTORY_SOURCES.get(first.lower()) or _DIRECTORY_SOURCES.get(first)
    if source is None:
        return None
    if any(part.startswith(".") for part in parts[1:]):
        return None
    if any(part.lower() in _BLOCKED_DIRECTORY_NAMES for part in parts[1:-1]):
        return None
    return source


def _validate_eligible_file(root: Path, path: str) -> tuple[Path, str, str]:
    normalized = normalize_project_relative_path(path)
    source_type = project_knowledge_source_type(normalized)
    if source_type is None:
        raise FsToolError(f"不属于允许的 Project Knowledge 来源：{path}")
    relative = PurePosixPath(normalized)
    if relative.suffix.lower() not in _ALLOWED_EXTENSIONS:
        raise FsToolError(f"Project Knowledge 文件类型不受支持：{path}")
    if any(_SENSITIVE_NAME.search(part) or part.lower() == ".env" for part in relative.parts):
        raise FsToolError(f"Project Knowledge 文件名疑似包含凭据：{path}")
    target = resolve_scoped_path(root, normalized)
    if not target.is_file():
        raise FsToolError(f"Project Knowledge 文件不存在：{path}")
    if target.stat().st_size > PROJECT_KNOWLEDGE_MAX_FILE_BYTES:
        raise FsToolError(f"Project Knowledge 文件超过 512 KiB：{path}")
    return target, normalized, source_type


def validate_project_knowledge_markdown_target(path: str) -> tuple[str, str]:
    """Validate a future author-owned Markdown target without requiring it to exist."""

    normalized = normalize_project_relative_path(path)
    source_type = project_knowledge_source_type(normalized)
    if source_type not in {"outline", "character", "setting", "timeline", "foreshadowing", "materials"}:
        raise FsToolError(f"知识提议目标必须位于作者语义资料目录：{path}")
    relative = PurePosixPath(normalized)
    if relative.suffix.lower() not in {".md", ".markdown"}:
        raise FsToolError(f"结构化 Project Knowledge 目标必须是 Markdown：{path}")
    if any(_SENSITIVE_NAME.search(part) or part.lower() == ".env" for part in relative.parts):
        raise FsToolError(f"Project Knowledge 文件名疑似包含凭据：{path}")
    return normalized, source_type


def project_knowledge_candidates(project_root: str, *, max_entries: int = PROJECT_KNOWLEDGE_MAX_CANDIDATES) -> list[dict]:
    root = resolve_project_root(project_root)
    candidates: list[dict] = []
    candidate_paths = [root / relative for relative in _STORYFORGE_FILES]
    for child in root.iterdir():
        source = _DIRECTORY_SOURCES.get(child.name.lower()) or _DIRECTORY_SOURCES.get(child.name)
        if source is not None and child.is_dir():
            candidate_paths.extend(child.rglob("*"))

    seen: set[str] = set()
    for path in candidate_paths:
        if not path.is_file():
            continue
        try:
            relative = path.relative_to(root).as_posix()
            target, normalized, source_type = _validate_eligible_file(root, relative)
        except (FsToolError, OSError):
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(
            {
                "path": normalized,
                "title": target.stem,
                "source_type": source_type,
                "size_bytes": target.stat().st_size,
            }
        )
    candidates.sort(key=lambda item: item["path"])
    return candidates[: max(max_entries, 0)]


def project_knowledge_read(
    project_root: str,
    path: str,
    *,
    offset: int = 0,
    limit: int = PROJECT_KNOWLEDGE_READ_LIMIT_DEFAULT,
) -> dict:
    root = resolve_project_root(project_root)
    target, normalized, source_type = _validate_eligible_file(root, path)
    if offset < 0:
        raise FsToolError("offset 不能为负数。")
    bounded_limit = min(max(limit, 1), PROJECT_KNOWLEDGE_READ_LIMIT_MAX)
    content = read_text_file(target)
    redacted_content = redact_sensitive_text(content)
    redacted = redacted_content != content
    slice_ = redacted_content[offset : offset + bounded_limit]
    warnings = [f"Project Knowledge 已脱敏：{normalized}"] if redacted else []
    return {
        "path": normalized,
        "source_type": source_type,
        "content": slice_,
        "offset": offset,
        "returned_chars": len(slice_),
        "total_chars": len(redacted_content),
        "truncated": offset + len(slice_) < len(redacted_content),
        "redacted": redacted,
        "warnings": warnings,
    }


def project_knowledge_entry_index(project_root: str) -> ProjectKnowledgeEntryIndex:
    root = resolve_project_root(project_root)
    entries: list[IndexedProjectKnowledgeEntry] = []
    warnings: list[str] = []
    for candidate in project_knowledge_candidates(project_root, max_entries=PROJECT_KNOWLEDGE_SEARCH_MAX_FILES):
        relative_path = str(candidate["path"])
        if PurePosixPath(relative_path).suffix.lower() not in {".md", ".markdown"}:
            continue
        try:
            target, normalized, _source_type = _validate_eligible_file(root, relative_path)
            parsed = parse_knowledge_markdown(read_text_file(target))
        except (FsToolError, OSError) as exc:
            warnings.append(f"{relative_path}: {exc}")
            continue
        entries.extend(
            IndexedProjectKnowledgeEntry(relative_path=normalized, entry=entry)
            for entry in parsed.entries
        )
        warnings.extend(f"{normalized}: {warning}" for warning in parsed.warnings)
    return ProjectKnowledgeEntryIndex(entries=tuple(entries), warnings=tuple(warnings))


def load_project_knowledge_document(project_root: str, path: str) -> ProjectKnowledgeDocument:
    """Load unredacted author Markdown for deterministic patch compilation, never model output."""

    root = resolve_project_root(project_root)
    target, normalized, source_type = _validate_eligible_file(root, path)
    if PurePosixPath(normalized).suffix.lower() not in {".md", ".markdown"}:
        raise FsToolError(f"结构化 Project Knowledge 目标必须是 Markdown：{path}")
    return ProjectKnowledgeDocument(
        absolute_path=str(target),
        relative_path=normalized,
        source_type=source_type,
        content=read_text_file(target),
    )


def project_knowledge_search(
    project_root: str,
    query: str,
    *,
    use_regex: bool = False,
    max_matches: int = PROJECT_KNOWLEDGE_SEARCH_MAX_MATCHES,
) -> dict:
    if not isinstance(query, str) or not query.strip():
        raise FsToolError("query 不能为空。")
    if use_regex:
        try:
            pattern = re.compile(query)
        except re.error as exc:
            raise FsToolError(f"正则表达式无效：{exc}") from exc
    else:
        pattern = None
    root = resolve_project_root(project_root)
    matches: list[dict] = []
    scanned_files = 0
    truncated = False
    redacted = False
    warnings: list[str] = []
    for item in project_knowledge_candidates(project_root, max_entries=PROJECT_KNOWLEDGE_SEARCH_MAX_FILES):
        scanned_files += 1
        target, normalized, _source_type = _validate_eligible_file(root, item["path"])
        content = read_text_file(target)
        redacted_content = redact_sensitive_text(content)
        file_redacted = redacted_content != content
        redacted = redacted or file_redacted
        if file_redacted:
            warnings.append(f"Project Knowledge 已脱敏：{normalized}")
        for line_number, line in enumerate(redacted_content.splitlines(), start=1):
            if not (pattern.search(line) if pattern else query in line):
                continue
            if len(matches) >= max_matches:
                truncated = True
                break
            matches.append(
                {
                    "path": item["path"],
                    "source_type": item["source_type"],
                    "line": line_number,
                    "excerpt": line.strip()[:200],
                }
            )
        if truncated:
            break
    return {
        "matches": matches,
        "scanned_files": scanned_files,
        "truncated": truncated,
        "redacted": redacted,
        "warnings": sorted(set(warnings)),
    }
