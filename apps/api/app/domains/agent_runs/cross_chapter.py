"""跨章一致性审校：把若干**完整章节**一起喂给语义模型，找章与章之间的硬冲突。

诊断（2026-07-30）：`ide/cross_chapter_consistency.py` 早就实现了这件事——多章正文同时
入 prompt，找时间线矛盾、称谓漂移、设定不一、已退场角色再出场、伏笔未回收——但它的出口
只有 REST 端点和 CLI，**没有 ToolSpec，对话循环调不到**。与此同时 system prompt 一直在
教模型用 `project_deep_consistency`，而那把只看单章：

    结构上，一个只读得了单章的检查器，永远抓不到「第 3 章说左臂受伤、第 11 章用左手拔剑」。

本模块是那个能力接进循环的适配层：解析路径边界、**按阅读序排好章**（模型给的顺序不可信，
而「按叙事顺序」正是那份 prompt 的前提）、调既有检查器、把结果整成 advisory 信号。

红线与 `deep_consistency` 同款：不写盘、不落 DB，未配置 LLM 或远程失败时显式报错，
绝不伪造「没有冲突」。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.common.llm_client import LLMConfigError, LLMError
from app.common.llm_env import resolved_llm_env
from app.domains.agent_runs.canon_rebuild import chapter_ordinals as _chapter_ordinals
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.fs_tools import read_text_file as _read_text
from app.domains.agent_runs.fs_tools import resolve_project_root as _resolve_root
from app.domains.agent_runs.fs_tools import resolve_scoped_path as _resolve_scoped
from app.domains.ide.cross_chapter_consistency import (
    PER_CHAPTER_CHAR_BUDGET,
    check_cross_chapter_consistency,
)

# 上限不是性能考量而是信噪比：一次塞十几章，模型会退回泛泛而谈，且每章预算被压到读不出上下文。
MAX_CHAPTERS = 6
MIN_CHAPTERS = 2
_MAX_FILE_BYTES = 512_000


def _ordered_chapters(project_root: str, paths: list[str]) -> list[dict[str, Any]]:
    """解析并按**阅读序**排好章；章序口径与 canon 一致（同一 `chapter_ordinals`）。

    模型给的 paths 顺序不可信，而下游 prompt 的第一句就是「以下是同一部小说的若干章节
    (按顺序)」——顺序错了，「时间线先后」这一类冲突会被判反。
    """

    root = _resolve_root(project_root)
    try:
        ordinals = _chapter_ordinals(project_root, "*.md")
    except FsToolError:
        ordinals = {}

    seen: set[str] = set()
    chapters: list[dict[str, Any]] = []
    for raw in paths:
        if not isinstance(raw, str) or not raw.strip():
            continue
        target = _resolve_scoped(root, raw.strip())
        if not target.is_file():
            raise FsToolError(f"不是文件：{raw.strip()}")
        relative = target.relative_to(root).as_posix()
        if relative in seen:
            continue
        seen.add(relative)
        text = _read_text(target, max_bytes=_MAX_FILE_BYTES)
        if not text.strip():
            raise FsToolError(f"文件没有可比对的正文：{relative}")
        chapters.append(
            {
                "path": relative,
                "chapter": ordinals.get(relative),
                "content": text,
                "chars": len(text),
                "truncated": len(text.strip()) > PER_CHAPTER_CHAR_BUDGET,
            }
        )

    # 非正文文件（大纲 / 设定）没有章序，排在正文之后而不是被当作第 0 章插到最前。
    chapters.sort(key=lambda item: (item["chapter"] is None, item["chapter"] or 0, item["path"]))
    return chapters


def cross_chapter_review(
    project_root: str,
    paths: list[str],
    *,
    focus: str | None = None,
    llm_env: Mapping[str, str | None] | None = None,
) -> dict[str, Any]:
    """对若干章做跨章一致性审校，返回 advisory finding 信号。"""

    if not isinstance(paths, list):
        raise FsToolError("paths 必须是字符串数组。")
    if len(paths) > MAX_CHAPTERS:
        raise FsToolError(f"一次最多比对 {MAX_CHAPTERS} 章；章数过多会让结论退回泛泛而谈，请分批。")

    chapters = _ordered_chapters(project_root, paths)
    if len(chapters) < MIN_CHAPTERS:
        raise FsToolError(f"跨章检查至少需要 {MIN_CHAPTERS} 个有正文的不同章节。")

    source = resolved_llm_env(llm_env)
    payload = [
        {
            "name": f"第{item['chapter']}章 {item['path']}" if item["chapter"] else item["path"],
            "content": item["content"],
        }
        for item in chapters
    ]
    try:
        result = check_cross_chapter_consistency(source, payload, focus=focus)
    except LLMConfigError as exc:
        raise FsToolError(
            f"跨章一致性未配置 LLM：请先在设置里配置模型服务，再做跨章检查。（{exc}）"
        ) from exc
    except LLMError as exc:
        raise FsToolError(
            f"跨章一致性模型调用失败，本轮没有产出结论；可稍后重试。（{exc}）"
        ) from exc

    findings = result.get("findings") or []
    return {
        "chapters": [
            {
                "path": item["path"],
                "chapter": item["chapter"],
                "chars": item["chars"],
                "truncated": item["truncated"],
            }
            for item in chapters
        ],
        "chapter_count": len(chapters),
        "finding_count": len(findings),
        "findings": findings,
        "model": result.get("model"),
        "per_chapter_char_budget": PER_CHAPTER_CHAR_BUDGET,
        "note": (
            "跨章 finding 是参考信号：每条都给了涉及章节与原文片段，回给作者前请按 path 抽读核实。"
            "超出每章预算的部分模型没读到（truncated=true），必要时分批再比一次。"
        ),
    }


__all__ = ["MAX_CHAPTERS", "MIN_CHAPTERS", "cross_chapter_review"]
