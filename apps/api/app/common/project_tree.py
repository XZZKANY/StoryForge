"""Project containment and complete, bounded directory discovery; no domain imports."""

from __future__ import annotations

import os
import stat
from collections.abc import Callable, Iterable
from pathlib import Path

MAX_DIRECTORY_ENTRIES = 20_000
MAX_DIRECTORY_DEPTH = 64
MAX_READ_BYTES = 2 * 1024 * 1024


class ProjectTreeError(RuntimeError):
    """A project tree cannot be traversed safely and completely."""


def scoped_target(root: Path, path: Path) -> Path:
    try:
        target = path.resolve()
        if not target.is_relative_to(root):
            raise ProjectTreeError("路径越界，只允许访问项目目录内文件。")
        return target
    except (OSError, RuntimeError) as exc:
        raise ProjectTreeError("无法解析项目文件路径。") from exc


def is_directory_link(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def scan_project_files(
    root: Path,
    *,
    scope: Path | None = None,
    visible: Callable[[Path], bool],
    explicit_files: Iterable[str] = (),
    max_entries: int | None = None,
    max_depth: int | None = None,
) -> list[Path]:
    """Return a complete sorted list or fail; never disguise budget exhaustion as completeness."""
    max_entries = MAX_DIRECTORY_ENTRIES if max_entries is None else max_entries
    max_depth = MAX_DIRECTORY_DEPTH if max_depth is None else max_depth
    scope = scope or root
    scoped_target(root, scope)
    files: set[Path] = set()
    pending = [(scope, 0)] if scope == root or visible(scope.relative_to(root)) else []
    visited_entries = 0
    try:
        while pending:
            directory, depth = pending.pop()
            # Recheck queued directories before opening them, including Windows junctions.
            target = scoped_target(root, directory)
            if directory != root and (is_directory_link(directory) or not visible(target.relative_to(root))):
                continue
            with os.scandir(directory) as entries:
                for entry in entries:
                    visited_entries += 1
                    if visited_entries > max_entries:
                        raise ProjectTreeError("项目目录项超过遍历预算，请缩小范围。")
                    path = Path(entry.path)
                    if not visible(path.relative_to(root)):
                        continue
                    try:
                        target = scoped_target(root, path)
                    except ProjectTreeError:
                        continue
                    if not visible(target.relative_to(root)):
                        continue
                    if entry.is_dir(follow_symlinks=False) and not is_directory_link(path):
                        if depth >= max_depth:
                            raise ProjectTreeError("项目目录超过最大遍历深度，请缩小范围。")
                        pending.append((path, depth + 1))
                    elif target.is_file():
                        files.add(path)
        for relative in explicit_files:
            path = root / relative
            if not path.is_relative_to(scope):
                continue
            try:
                target = scoped_target(root, path)
            except ProjectTreeError:
                continue
            if target.is_file() and visible(target.relative_to(root)):
                files.add(path)
    except OSError as exc:
        raise ProjectTreeError("项目目录无法完整遍历，请检查权限或文件是否已移动。") from exc
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())
