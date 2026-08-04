"""Path-scoped 只读项目文件工具：fs.list / fs.read / fs.search。

Alpha 单机形态下 sidecar 后端与项目文件同机，Agent loop 的只读上下文获取
直接在后端完成；写回仍走 proposed patch 前端确认，本模块绝不提供写接口。
所有入口都以 project_root 为边界，resolve 后越界即拒绝（含 ../ 与符号链接逃逸）。
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from app.common.author_voice import RELATIVE_PATH as _AUTHOR_INSTRUCTIONS_PATH

# 对小说项目无意义且可能巨大的目录，列表/检索时跳过。
_SKIPPED_DIR_NAMES = frozenset({".git", ".storyforge", ".codex", "node_modules", "__pycache__"})

# 定点豁免：作者自定义指令是**作者写给 agent 的长期偏好**，agent 看不见它就无法在作者
# 说出长期偏好时提议写进去，跨会话记忆也就无从谈起。只放行这一个文件而不是整个
# `.storyforge/`——canon 的 derived 缓存会把上下文预算涌满。
_VISIBLE_DOT_FILES = frozenset({_AUTHOR_INSTRUCTIONS_PATH})

_READ_LIMIT_DEFAULT = 20_000
_READ_LIMIT_MAX = 200_000
_LIST_MAX_ENTRIES_DEFAULT = 500
_SEARCH_MAX_MATCHES_DEFAULT = 50
_SEARCH_MAX_FILE_BYTES = 512_000
_SEARCH_MAX_FILES = 2_000
_EXCERPT_MAX_CHARS = 200
# 超过这个体积就不必再读内容判空白：真稿一定不是占位文件。
_BLANK_PLACEHOLDER_MAX_BYTES = 4_096


class FsToolError(RuntimeError):
    """只读文件工具的输入或边界错误，消息可直接回给 LLM/用户。"""


def normalize_project_relative_path(path: str) -> str:
    """Normalize a model/user supplied path without resolving it outside a project root."""

    if not isinstance(path, str) or not path.strip():
        raise FsToolError("path 不能为空。")
    raw = path.strip().replace("\\", "/")
    candidate = PurePosixPath(raw)
    if candidate.is_absolute() or ":" in candidate.parts[0] or any(
        part in {"", ".", ".."} for part in candidate.parts
    ):
        raise FsToolError(f"只接受规范化项目相对路径：{path}")
    return candidate.as_posix()


def _resolve_root(project_root: str) -> Path:
    if not isinstance(project_root, str) or not project_root.strip():
        raise FsToolError("project_root 不能为空。")
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise FsToolError(f"项目目录不存在：{project_root}")
    return root


def _resolve_scoped(root: Path, subpath: str | None) -> Path:
    candidate = root if not subpath else (root / subpath)
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise FsToolError(f"路径越界，只允许访问项目目录内文件：{subpath}")
    return resolved


def _is_skipped(relative: Path) -> bool:
    if relative.as_posix() in _VISIBLE_DOT_FILES:
        return False
    return any(part in _SKIPPED_DIR_NAMES or part.startswith(".") for part in relative.parts)


def _iter_project_files(root: Path) -> list[Path]:
    files = [
        path
        for path in root.rglob("*")
        if path.is_file() and not _is_skipped(path.relative_to(root))
    ]
    files.sort(key=lambda path: path.relative_to(root).as_posix())
    return files


def _read_text(path: Path, *, max_bytes: int | None = None) -> str:
    raw = path.read_bytes()
    if max_bytes is not None and len(raw) > max_bytes:
        raw = raw[:max_bytes]
    if b"\x00" in raw[:1024]:
        raise FsToolError(f"不是文本文件，无法读取：{path.name}")
    # 统一换行为 \n：offset/检索行号跨平台一致，也避免 CRLF 浪费上下文预算。
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")


def resolve_project_file(project_root: str, path: str) -> str:
    """把项目内相对路径解析为绝对路径（越界拒绝），供修订补丁携带可写回的真实路径。"""

    if not isinstance(path, str) or not path.strip():
        raise FsToolError("path 不能为空。")
    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"文件不存在：{path}")
    return str(target)


def _is_blank_placeholder(path: Path) -> bool:
    """空文件或只有空白字符——作者先建占位再让 Agent 写，起草可直接落进去。"""

    try:
        if path.stat().st_size > _BLANK_PLACEHOLDER_MAX_BYTES:
            return False
        return not path.read_bytes().strip()
    except OSError:
        return False


def resolve_new_project_file(project_root: str, path: str) -> str:
    """把「尚不存在（或空占位）的项目内相对路径」解析为绝对路径（越界拒绝），供新文件起草补丁使用。"""

    if not isinstance(path, str) or not path.strip():
        raise FsToolError("path 不能为空。")
    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if target == root or target.is_dir():
        raise FsToolError(f"不是可创建的文件路径：{path}")
    # 空占位不算「已存在」：否则与 file_revise 的「content 不能为空」互相推诿，空章节文件谁也写不进去。
    if target.exists() and not _is_blank_placeholder(target):
        raise FsToolError(f"文件已存在：{path}，请改用 file_revise 修订既有文件。")
    return str(target)


def fs_list(
    project_root: str,
    subpath: str | None = None,
    *,
    max_entries: int = _LIST_MAX_ENTRIES_DEFAULT,
) -> dict:
    """列出项目内文件（递归、相对路径、按路径排序），供 Agent 了解项目结构。"""

    root = _resolve_root(project_root)
    scope = _resolve_scoped(root, subpath)
    if not scope.is_dir():
        raise FsToolError(f"不是目录：{subpath}")

    entries: list[dict] = []
    truncated = False
    for path in _iter_project_files(root):
        if scope != root and scope not in path.parents:
            continue
        if len(entries) >= max_entries:
            truncated = True
            break
        stat = path.stat()
        entries.append(
            {
                "path": path.relative_to(root).as_posix(),
                "size_bytes": stat.st_size,
            }
        )
    return {"entries": entries, "truncated": truncated}


def fs_read(
    project_root: str,
    path: str,
    *,
    offset: int = 0,
    limit: int = _READ_LIMIT_DEFAULT,
) -> dict:
    """读取项目内单个文本文件的内容切片。"""

    if not isinstance(path, str) or not path.strip():
        raise FsToolError("path 不能为空。")
    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"文件不存在：{path}")
    if _is_skipped(target.relative_to(root)):
        raise FsToolError(f"隐藏路径不可通过 fs.read 读取：{path}")
    if offset < 0:
        raise FsToolError("offset 不能为负数。")
    bounded_limit = min(max(limit, 1), _READ_LIMIT_MAX)

    content = _read_text(target)
    slice_ = content[offset : offset + bounded_limit]
    return {
        "path": target.relative_to(root).as_posix(),
        "content": slice_,
        "offset": offset,
        "returned_chars": len(slice_),
        "total_chars": len(content),
        "truncated": offset + len(slice_) < len(content),
    }


def fs_search(
    project_root: str,
    query: str,
    *,
    glob: str = "*.md",
    max_matches: int = _SEARCH_MAX_MATCHES_DEFAULT,
    use_regex: bool = False,
) -> dict:
    """在项目文本文件里跨文件检索，返回 path + 行号 + 摘录。"""

    if not isinstance(query, str) or not query.strip():
        raise FsToolError("query 不能为空。")
    root = _resolve_root(project_root)

    if use_regex:
        try:
            pattern = re.compile(query)
        except re.error as exc:
            raise FsToolError(f"正则表达式无效：{exc}") from exc
    else:
        pattern = None

    matches: list[dict] = []
    truncated = False
    scanned_files = 0
    for path in _iter_project_files(root):
        if not path.match(glob):
            continue
        if scanned_files >= _SEARCH_MAX_FILES:
            truncated = True
            break
        scanned_files += 1
        try:
            content = _read_text(path, max_bytes=_SEARCH_MAX_FILE_BYTES)
        except FsToolError:
            continue
        for line_number, line in enumerate(content.splitlines(), start=1):
            hit = pattern.search(line) if pattern else (query in line)
            if not hit:
                continue
            if len(matches) >= max_matches:
                truncated = True
                break
            matches.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "line": line_number,
                    "excerpt": line.strip()[:_EXCERPT_MAX_CHARS],
                }
            )
        if len(matches) >= max_matches and truncated:
            break
    return {"matches": matches, "truncated": truncated, "scanned_files": scanned_files}


resolve_project_root = _resolve_root
resolve_scoped_path = _resolve_scoped
iter_project_files = _iter_project_files
read_text_file = _read_text
