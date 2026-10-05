"""Bounded filesystem primitives shared by project file tools."""

from __future__ import annotations

import codecs
import os
import stat
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from time import monotonic

import regex

from app.common import project_tree

MAX_DIRECTORY_ENTRIES = project_tree.MAX_DIRECTORY_ENTRIES
MAX_DIRECTORY_DEPTH = project_tree.MAX_DIRECTORY_DEPTH
MAX_READ_BYTES = project_tree.MAX_READ_BYTES
MAX_SEARCH_BYTES = 16 * 1024 * 1024
MAX_QUERY_CHARS = 2_048
REGEX_MATCH_SECONDS = 0.05
REGEX_TOTAL_SECONDS = 2.0


class FsToolError(RuntimeError):
    """A file tool could not safely complete the requested operation."""


class FsBinaryFileError(FsToolError):
    """A regular file is not text and may be skipped during text search."""


def positive_limit(value: int, name: str, maximum: int) -> int:
    if type(value) is not int or value < 1:
        raise FsToolError(f"{name} 必须是正整数。")
    return min(value, maximum)


def scoped_target(root: Path, path: Path) -> Path:
    try:
        return project_tree.scoped_target(root, path)
    except project_tree.ProjectTreeError as exc:
        raise FsToolError(str(exc)) from exc


def is_directory_link(path: Path) -> bool:
    return project_tree.is_directory_link(path)


def scan_project_files(
    root: Path,
    *,
    scope: Path | None = None,
    visible: Callable[[Path], bool],
    explicit_files: Iterable[str] = (),
) -> list[Path]:
    try:
        return project_tree.scan_project_files(
            root,
            scope=scope,
            visible=visible,
            explicit_files=explicit_files,
            max_entries=MAX_DIRECTORY_ENTRIES,
            max_depth=MAX_DIRECTORY_DEPTH,
        )
    except project_tree.ProjectTreeError as exc:
        raise FsToolError(str(exc)) from exc


@dataclass(frozen=True)
class TextRead:
    content: str
    bytes_read: int
    truncated: bool


def read_bounded_text(path: Path, *, max_bytes: int | None = None) -> TextRead:
    cap = MAX_READ_BYTES if max_bytes is None else positive_limit(max_bytes, "max_bytes", MAX_READ_BYTES)
    try:
        if not stat.S_ISREG(path.stat().st_mode):
            raise FsToolError("只允许读取普通文件。")
        with path.open("rb", buffering=0) as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise FsToolError("只允许读取普通文件。")
            raw = stream.read(cap + 1)
    except OSError as exc:
        raise FsToolError(f"文件无法读取：{path.name}") from exc
    truncated = len(raw) > cap
    if truncated and max_bytes is None:
        raise FsToolError(f"文件超过完整读取预算（{MAX_READ_BYTES} 字节）：{path.name}")
    if b"\x00" in raw[:1024]:
        raise FsBinaryFileError(f"不是文本文件，无法读取：{path.name}")
    content = codecs.getincrementaldecoder("utf-8")("replace").decode(raw[:cap], final=not truncated)
    return TextRead(content.replace("\r\n", "\n").replace("\r", "\n"), len(raw), truncated)


class SearchMatcher:
    """Keep external regex execution bounded across every line in one search."""

    def __init__(self, query: str, *, use_regex: bool = False) -> None:
        if not isinstance(query, str) or not query.strip():
            raise FsToolError("query 不能为空。")
        if len(query) > MAX_QUERY_CHARS:
            raise FsToolError(f"query 超过 {MAX_QUERY_CHARS} 字符。")
        self.query = query
        self.remaining_seconds = REGEX_TOTAL_SECONDS
        try:
            self.pattern = regex.compile(query, regex.VERSION0) if use_regex else None
        except (regex.error, RecursionError) as exc:
            raise FsToolError(f"正则表达式无效：{exc}") from exc

    def search(self, line: str) -> bool:
        if self.pattern is None:
            return self.query in line
        if self.remaining_seconds <= 0:
            raise FsToolError("正则搜索累计时间预算已耗尽，请简化查询。")
        started = monotonic()
        try:
            return self.pattern.search(line, timeout=min(REGEX_MATCH_SECONDS, self.remaining_seconds)) is not None
        except TimeoutError as exc:
            raise FsToolError("正则搜索超时，请简化查询。") from exc
        finally:
            self.remaining_seconds -= monotonic() - started
