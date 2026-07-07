"""Canon 落盘 IO：作者所有的 canon.json + 后端派生缓存 derived/。

现代防漂移形状 slice 1：手稿正文是唯一真值源，canon 是从正文可重建的可弃缓存，
scope 接 project_path 而非 book_run_id（对比已弃的 story_state 事件源）。

红线例外（本模块唯一新授权）：后端首次向作者项目目录写文件，但严格限定——
只写派生缓存到 .storyforge/canon/derived/，绝不碰手稿正文；写路径由 project_root
后端硬拼，不接受任何外部传入路径。canon.json 视为作者所有，本模块只读 / 缺失时脚手架空模板。
路径边界复用 fs_tools（同包私有复用，先例见 consistency_scan / style_fingerprint）。
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.domains.agent_runs.fs_tools import FsToolError, _resolve_root

_CANON_DIRNAME = ".storyforge"
_CANON_SUBDIR = "canon"
_CANON_FILENAME = "canon.json"
_DERIVED_DIRNAME = "derived"

# 派生缓存文件白名单：写入口只接受这些名字，杜绝借 name 参数穿目录。
_ALLOWED_DERIVED_NAMES = frozenset({"presence.json", "report.json"})
# 派生文本缓存白名单（人可读投影，非 JSON）。
_ALLOWED_DERIVED_TEXT_NAMES = frozenset({"dossier.md"})

_EMPTY_CANON: dict[str, Any] = {"version": 1, "entities": [], "invariants": {}}


def _canon_dir(project_root: str) -> Path:
    """后端硬拼 .storyforge/canon 绝对路径（不接受外部子路径），确保写入永远落在缓存目录内。"""

    root = _resolve_root(project_root)
    return root / _CANON_DIRNAME / _CANON_SUBDIR


def _canon_file(project_root: str) -> Path:
    return _canon_dir(project_root) / _CANON_FILENAME


def _atomic_write_text(target: Path, text: str) -> None:
    """同目录 temp file + os.replace 原子落盘：写一半崩溃不会留下半截文件。

    镜像 W7 Rust fs.rs::stage_atomic_write 的原子性不变量（纯 Python 版）。
    """

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp_name)
        raise


def _atomic_write_json(target: Path, payload: dict[str, Any]) -> None:
    _atomic_write_text(target, json.dumps(payload, ensure_ascii=False, indent=2))


def read_canon(project_root: str) -> dict[str, Any]:
    """读作者的 canon.json；不存在或不合法时明确返回空骨架（不伪造数据，明确空态）。"""

    canon_file = _canon_file(project_root)
    if not canon_file.is_file():
        return dict(_EMPTY_CANON)
    try:
        raw = canon_file.read_text(encoding="utf-8")
        parsed = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise FsToolError(f"canon.json 无法解析：{exc}") from exc
    if not isinstance(parsed, dict):
        raise FsToolError("canon.json 顶层必须是 JSON 对象。")
    parsed.setdefault("version", 1)
    parsed.setdefault("entities", [])
    parsed.setdefault("invariants", {})
    return parsed


def scaffold_canon_if_missing(project_root: str) -> bool:
    """canon.json 缺失时原子写一份空模板确立格式；已存在则不动。返回是否新建。"""

    canon_file = _canon_file(project_root)
    if canon_file.exists():
        return False
    _atomic_write_json(canon_file, _EMPTY_CANON)
    return True


def _resolve_derived_target(project_root: str, name: str, allowed: frozenset[str]) -> Path:
    """白名单校验 + 双保险越界断言，返回 derived/<name> 绝对路径。"""

    if name not in allowed:
        raise FsToolError(f"不允许的派生缓存文件名：{name}")
    canon_dir = _canon_dir(project_root)
    target = (canon_dir / _DERIVED_DIRNAME / name).resolve()
    # 双保险：即便上游拼错，也断言最终路径没逃出 canon 目录（防越界注入）。
    if canon_dir.resolve() not in target.parents:
        raise FsToolError("派生缓存路径越界。")
    return target


def write_derived(project_root: str, name: str, payload: dict[str, Any]) -> str:
    """原子写派生缓存到 .storyforge/canon/derived/<name>；name 走白名单，路径断言仍在 canon 目录内。"""

    target = _resolve_derived_target(project_root, name, _ALLOWED_DERIVED_NAMES)
    _atomic_write_json(target, payload)
    return str(target)


def write_derived_text(project_root: str, name: str, text: str) -> str:
    """原子写人可读派生投影（如 dossier.md）到 derived/<name>；独立文本白名单。"""

    target = _resolve_derived_target(project_root, name, _ALLOWED_DERIVED_TEXT_NAMES)
    _atomic_write_text(target, text)
    return str(target)


def read_derived(project_root: str, name: str) -> dict[str, Any] | None:
    """读派生缓存；不存在或不合法返回 None（可弃缓存，缺失即触发重建）。"""

    if name not in _ALLOWED_DERIVED_NAMES:
        raise FsToolError(f"不允许的派生缓存文件名：{name}")
    target = _canon_dir(project_root) / _DERIVED_DIRNAME / name
    if not target.is_file():
        return None
    try:
        parsed = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None
