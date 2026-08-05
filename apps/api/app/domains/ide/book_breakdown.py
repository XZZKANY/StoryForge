"""本地参考文本的只读结构化拆书：解析、采样和可追溯报告。

首版刻意不把整本书送入模型。这里先产出确定性的章节索引、代表章选择和
待补充分析 schema；后续模型分析可以复用同一份 selection/context 契约。
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
import zipfile
from collections.abc import Mapping
from pathlib import Path
from threading import Event
from typing import Any
from xml.etree import ElementTree

from app.domains.agent_runs.canon_store import atomic_write_json, atomic_write_text
from app.domains.agent_runs.fs_tools import iter_project_files, resolve_project_root
from app.domains.book_runs.book_generation import call_llm as _call_llm
from app.domains.ide.book_breakdown_control import (
    prepare_breakdown_cancellation,
    release_breakdown_cancellation,
    request_breakdown_cancel,
)

ANALYSIS_SCHEMA_VERSION = "storyforge.breakdown.v1"
SELECTION_STRATEGY_VERSION = "anchors.v1"
_SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".json", ".docx"}
_CHAPTER_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:(?:第\s*)?([0-9]{1,5}|[零〇一二两三四五六七八九十百千万]+)\s*(?:章|节|回)\b|Chapter\s+([0-9]{1,5})\b)(.*)$",
    re.IGNORECASE,
)
_JSON_CONTENT_KEYS = ("content", "text", "body", "正文", "内容")
_ANALYSIS_KEYS = (
    "story_structure",
    "characters_and_relations",
    "conflict_and_rhythm",
    "setting_and_world",
    "craft_methods",
    "transferable_insights",
)
_MODEL_SYSTEM_PROMPT = (
    "你是小说拆书分析师。只根据提供的代表章节分析写作方法，不复述完整剧情，不补写未提供的事实。"
    "每个字段说明为什么有效、可以如何迁移到新作品；证据不足时明确写信息不足。"
    "只输出 JSON 对象，不要 Markdown、代码块或额外解释。"
)


class BookBreakdownError(ValueError):
    """拆书输入、解析或持久化失败。"""

class BookBreakdownCancelled(BookBreakdownError):
    """拆书被作者主动取消，已生成的派生文件仍需标记为 cancelled。"""


def _raise_if_cancelled(cancel_event: Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise BookBreakdownCancelled("结构化拆书已取消。")


def _normalize_text(raw: str) -> str:
    return raw.replace("\r\n", "\n").replace("\r", "\n").strip()


def _parse_ordinal(value: str | None) -> int | None:
    if not value:
        return None
    if value.isdigit():
        return int(value)
    digits = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    if value in digits:
        return digits[value]
    if value == "十":
        return 10
    if value.startswith("十"):
        return 10 + digits.get(value[1:], 0)
    if value.endswith("十"):
        return digits.get(value[:-1], 0) * 10
    if "十" in value:
        left, right = value.split("十", 1)
        return digits.get(left, 0) * 10 + digits.get(right, 0)
    return None


def _read_docx(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (OSError, KeyError, zipfile.BadZipFile) as exc:
        raise BookBreakdownError(f"DOCX 无法读取：{path.name}") from exc
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise BookBreakdownError(f"DOCX 正文无法解析：{path.name}") from exc
    paragraphs: list[str] = []
    for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        text = "".join(
            node.text or ""
            for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
        )
        if text.strip():
            paragraphs.append(text.strip())
    return "\n".join(paragraphs)


def _json_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(_json_text(item) for item in value)
    if isinstance(value, dict):
        for key in _JSON_CONTENT_KEYS:
            if key in value:
                return _json_text(value[key])
        return "\n".join(f"{key}: {_json_text(item)}" for key, item in value.items())
    return str(value)


def _read_source(path: Path) -> str:
    if path.suffix.lower() == ".docx":
        return _normalize_text(_read_docx(path))
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise BookBreakdownError(f"文件无法读取：{path.name}") from exc
    if b"\x00" in raw[:1024]:
        raise BookBreakdownError(f"文件不是可解析文本：{path.name}")
    text = raw.decode("utf-8", errors="replace")
    if path.suffix.lower() == ".json":
        try:
            text = _json_text(json.loads(text))
        except json.JSONDecodeError as exc:
            raise BookBreakdownError(f"JSON 无法解析：{path.name}") from exc
    return _normalize_text(text)


def parse_chapters(text: str, source_path: str) -> list[dict[str, Any]]:
    """按常见中英文章节标题拆分；没有标题时明确退化为单章。"""

    normalized = _normalize_text(text)
    if not normalized:
        return []
    lines = normalized.split("\n")
    headings: list[tuple[int, str, int | None]] = []
    for index, line in enumerate(lines):
        match = _CHAPTER_RE.match(line)
        if not match:
            continue
        ordinal_raw = match.group(1) or match.group(2)
        title = line.strip().lstrip("#").strip()
        headings.append((index, title, _parse_ordinal(ordinal_raw)))

    if not headings:
        return [
            {
                "chapter_id": f"{source_path}:1",
                "ordinal": 1,
                "title": Path(source_path).stem or "全文",
                "source_path": source_path,
                "start_line": 1,
                "end_line": len(lines),
                "content": normalized,
                "degraded_single_chapter": True,
            }
        ]

    chapters: list[dict[str, Any]] = []
    for position, (start, title, explicit_ordinal) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        body = "\n".join(lines[start + 1 : end]).strip()
        if not body:
            continue
        ordinal = explicit_ordinal or position + 1
        chapters.append(
            {
                "chapter_id": f"{source_path}:{position + 1}",
                "ordinal": ordinal,
                "title": title,
                "source_path": source_path,
                "start_line": start + 1,
                "end_line": end,
                "content": body,
                "degraded_single_chapter": False,
            }
        )
    return chapters


def load_project_chapters(project_root: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    root = resolve_project_root(project_root)
    chapters: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    for path in iter_project_files(root):
        if path.suffix.lower() not in _SUPPORTED_EXTENSIONS:
            continue
        relative = path.relative_to(root).as_posix()
        try:
            text = _read_source(path)
        except BookBreakdownError:
            continue
        parsed = parse_chapters(text, relative)
        if not parsed:
            continue
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        sources.append({"path": relative, "sha256": digest, "chars": len(text), "chapter_count": len(parsed)})
        chapters.extend(parsed)
    if not chapters:
        raise BookBreakdownError("项目内没有可解析的 TXT、Markdown、JSON 或 DOCX 正文。")
    chapters.sort(key=lambda item: (item["source_path"], item["start_line"], item["chapter_id"]))
    for index, chapter in enumerate(chapters, start=1):
        chapter["global_index"] = index
        chapter.pop("content", None)
    # Reload content only for selected chapters later; source metadata stays compact.
    return chapters, sources


def _chapter_content(root: Path, chapter: dict[str, Any]) -> str:
    source = root / chapter["source_path"]
    parsed = parse_chapters(_read_source(source), chapter["source_path"])
    for item in parsed:
        if item["chapter_id"] == chapter["chapter_id"]:
            return item["content"]
    return ""


def select_representative_chapters(
    chapters: list[dict[str, Any]], *, target_count: int = 8
) -> list[dict[str, Any]]:
    if not chapters:
        return []
    target = max(3, min(target_count, 12, len(chapters)))
    positions = {0, min(1, len(chapters) - 1), min(2, len(chapters) - 1), len(chapters) - 1}
    for fraction in (0.25, 0.5, 0.75):
        positions.add(round((len(chapters) - 1) * fraction))
    selected: list[dict[str, Any]] = []
    for position in sorted(positions):
        if len(selected) >= target:
            break
        chapter = chapters[position]
        reason = "结构锚点：开篇" if position <= 2 else "结构锚点：结尾" if position == len(chapters) - 1 else "结构锚点：全书位置"
        selected.append({"chapter_id": chapter["chapter_id"], "global_index": chapter["global_index"], "title": chapter["title"], "source_path": chapter["source_path"], "reason": reason})
    return selected


def _analysis_fields(selected: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    refs = [item["chapter_id"] for item in selected]
    message = "已生成代表章节索引；在线模型分析尚未运行，需在后续阶段补充。"
    return {
        key: {"status": "pending", "summary": message, "evidence_refs": refs, "confidence": "unavailable"}
        for key in _ANALYSIS_KEYS
    }


def _sources_hash(sources: list[dict[str, Any]]) -> str:
    return hashlib.sha256(
        json.dumps(sources, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 结构化拆书报告",
        "",
        f"- 状态：{report.get('status', 'unknown')}",
        f"- 输入指纹：`{report.get('input_sha256', '')}`",
        f"- 章节：{report.get('chapter_count', 0)}，代表章：{len(report.get('selected_chapters', []))}",
        "",
        "## 代表章节",
        "",
    ]
    for item in report.get("selected_chapters", []):
        if not isinstance(item, dict):
            continue
        lines.append(
            f"- 第{item.get('global_index', '?')}章 {item.get('title', '未命名')}：{item.get('reason', '结构锚点')}"
        )
    lines.extend(["", "## 分析字段", ""])
    for key, value in (report.get("analysis") or {}).items():
        if not isinstance(value, dict):
            continue
        lines.extend([f"### {key}", "", str(value.get("summary", "待补充。")), ""])
    notice = report.get("notice")
    if notice:
        lines.extend(["## 说明", "", str(notice), ""])
    return "\n".join(lines)


def _strip_json_fence(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _parse_model_analysis(raw: object, selected: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        raise BookBreakdownError("模型分析返回为空。")
    text = _strip_json_fence(raw)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise BookBreakdownError("模型分析不是有效 JSON。") from None
        parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise BookBreakdownError("模型分析顶层必须是 JSON 对象。")
    refs = [item["chapter_id"] for item in selected]
    result: dict[str, dict[str, Any]] = {}
    for key in _ANALYSIS_KEYS:
        value = parsed.get(key)
        if isinstance(value, dict):
            summary = value.get("summary") or value.get("analysis") or value.get("内容")
            evidence = value.get("evidence_refs")
        else:
            summary = value
            evidence = None
        if not isinstance(summary, str) or not summary.strip():
            result[key] = {"status": "pending", "summary": "模型未提供该字段，待补充。", "evidence_refs": refs, "confidence": "unavailable"}
            continue
        result[key] = {
            "status": "completed",
            "summary": " ".join(summary.split())[:1600],
            "evidence_refs": [item for item in evidence if isinstance(item, str)][:20] if isinstance(evidence, list) else refs,
            "confidence": "model",
        }
    return result

def _model_analysis(project_root: str, selected: list[dict[str, Any]], source: Mapping[str, str | None]) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    context = selected_context(project_root, {"selected_chapters": selected})
    user_prompt = (
        "请分析以下代表章节。输出字段必须包含：" + ", ".join(_ANALYSIS_KEYS)
        + "。每个字段可以是字符串，也可以是 {summary, evidence_refs} 对象。\n\n" + context
    )
    try:
        response = _call_llm(source, system_prompt=_MODEL_SYSTEM_PROMPT, user_prompt=user_prompt)
        return _parse_model_analysis(response.get("content"), selected), {"provider": source.get("STORYFORGE_LLM_PROVIDER"), "model": source.get("STORYFORGE_LLM_MODEL"), "retries": 0}
    except Exception:
        try:
            response = _call_llm(source, system_prompt=_MODEL_SYSTEM_PROMPT, user_prompt=user_prompt + "\n\n再次强调：只输出完整 JSON 对象，缺失字段也必须输出空字符串。")
            return _parse_model_analysis(response.get("content"), selected), {"provider": source.get("STORYFORGE_LLM_PROVIDER"), "model": source.get("STORYFORGE_LLM_MODEL"), "retries": 1}
        except Exception as exc:
            raise BookBreakdownError("structured_analysis_failed") from exc

def _persist_report(
    root: Path,
    report: dict[str, Any],
    sources: list[dict[str, Any]],
    chapters: list[dict[str, Any]],
    selected: list[dict[str, Any]],
) -> dict[str, Any]:
    analysis_dir = root / ".storyforge" / "analysis"
    input_hash = str(report.get("input_sha256") or "")
    atomic_write_json(analysis_dir / "book-breakdown.json", report)
    atomic_write_json(
        analysis_dir / "chapters.json",
        {"schema_version": ANALYSIS_SCHEMA_VERSION, "input_sha256": input_hash, "sources": sources, "chapters": chapters},
    )
    atomic_write_json(
        analysis_dir / "selection.json",
        {"strategy_version": SELECTION_STRATEGY_VERSION, "input_sha256": input_hash, "selected": selected},
    )
    atomic_write_text(analysis_dir / "book-breakdown.md", _render_markdown(report))
    return {
        **report,
        "paths": [
            ".storyforge/analysis/book-breakdown.json",
            ".storyforge/analysis/chapters.json",
            ".storyforge/analysis/selection.json",
            ".storyforge/analysis/book-breakdown.md",
        ],
    }

def run_book_breakdown(
    project_root: str,
    *,
    target_count: int = 8,
    model_source: Mapping[str, str | None] | None = None,
    analysis_id: str | None = None,
    cancel_event: Event | None = None,
) -> dict[str, Any]:
    root = resolve_project_root(project_root)
    analysis_id = analysis_id or uuid.uuid4().hex
    cancel_event = cancel_event or prepare_breakdown_cancellation(analysis_id)
    chapters: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    selected: list[dict[str, Any]] = []
    try:
        _raise_if_cancelled(cancel_event)
        chapters, sources = load_project_chapters(project_root)
        _raise_if_cancelled(cancel_event)
        selected = select_representative_chapters(chapters, target_count=target_count)
        _raise_if_cancelled(cancel_event)
        input_hash = _sources_hash(sources)
        analysis = _analysis_fields(selected)
        model_meta: dict[str, Any] = {"provider": None, "model": None, "retries": 0}
        model_error: str | None = None
        if model_source is not None:
            try:
                analysis, model_meta = _model_analysis(project_root, selected, model_source)
            except BookBreakdownError as exc:
                model_error = str(exc)
        _raise_if_cancelled(cancel_event)
        report = {
            "analysis_id": analysis_id,
            "status": "completed" if model_source is not None and model_error is None else "completed_deterministic",
            "schema_version": ANALYSIS_SCHEMA_VERSION,
            "selection_strategy_version": SELECTION_STRATEGY_VERSION,
            "input_sha256": input_hash,
            "source_count": len(sources),
            "chapter_count": len(chapters),
            "selected_chapters": selected,
            "analysis": analysis,
            "model": model_meta.get("model"),
            "provider": model_meta.get("provider"),
            "retries": model_meta.get("retries", 0),
            "limits": {"target_count": target_count, "model_context": "selected_chapters_only"},
            "notice": "分析结果只基于选定章节，不能替代人工通读。",
        }
        if model_error:
            report["model_error"] = model_error
        report["paths"] = _persist_report(root, report, sources, chapters, selected)
        return report
    except BookBreakdownCancelled:
        input_hash = _sources_hash(sources)
        report = {
            "analysis_id": analysis_id,
            "status": "cancelled",
            "schema_version": ANALYSIS_SCHEMA_VERSION,
            "selection_strategy_version": SELECTION_STRATEGY_VERSION,
            "input_sha256": input_hash,
            "source_count": len(sources),
            "chapter_count": len(chapters),
            "selected_chapters": selected,
            "analysis": _analysis_fields(selected),
            "model": None,
            "provider": None,
            "retries": 0,
            "limits": {"target_count": target_count, "model_context": "selected_chapters_only"},
            "notice": "本次拆书已取消，报告只包含取消前已生成的确定性底稿。",
        }
        report["paths"] = _persist_report(root, report, sources, chapters, selected)
        return report
    finally:
        release_breakdown_cancellation(analysis_id)

def read_book_breakdown_status(project_root: str) -> dict[str, Any]:
    """读取已有报告并用当前可解析来源重新计算指纹，显式报告是否过期。"""

    root = resolve_project_root(project_root)
    report_path = root / ".storyforge" / "analysis" / "book-breakdown.json"
    if not report_path.is_file():
        return {"status": "missing", "stale": False, "report_path": ".storyforge/analysis/book-breakdown.json"}
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BookBreakdownError("已有拆书报告无法解析。") from exc
    if not isinstance(report, dict):
        raise BookBreakdownError("已有拆书报告顶层必须是 JSON 对象。")
    _chapters, sources = load_project_chapters(project_root)
    current_hash = _sources_hash(sources)
    recorded_hash = report.get("input_sha256")
    stale = not isinstance(recorded_hash, str) or recorded_hash != current_hash
    return {
        "status": "stale" if stale else str(report.get("status") or "fresh"),
        "stale": stale,
        "input_sha256": recorded_hash,
        "current_input_sha256": current_hash,
        "analysis_id": report.get("analysis_id"),
        "report_path": ".storyforge/analysis/book-breakdown.json",
        "markdown_path": ".storyforge/analysis/book-breakdown.md",
    }


def selected_context(project_root: str, report: dict[str, Any], *, max_chars: int = 120_000) -> str:
    """组装带来源标签的有限上下文，供后续模型阶段使用。"""

    root = resolve_project_root(project_root)
    chunks: list[str] = []
    used = 0
    for item in report.get("selected_chapters", []):
        if not isinstance(item, dict):
            continue
        chapter = _chapter_content(root, item)
        if not chapter:
            continue
        block = f"### {item.get('title', '未命名')} [{item.get('reason', '结构锚点')}]\n{chapter}\n"
        if used + len(block) > max_chars:
            break
        chunks.append(block)
        used += len(block)
    return "\n---\n".join(chunks)
