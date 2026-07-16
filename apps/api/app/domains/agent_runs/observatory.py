"""世界线观测镜聚合扫描：跑确定性检查器，归一化观测信号落派生缓存（无 LLM，无 key）。

聚合三路有真信号的确定性检查（canon 闸门 / 伏笔承诺账 / 文笔气味），把各自的
issue 归一化成前端 ObsPanel 可直接消费的 Observation 形状，写进
.storyforge/canon/derived/observations.json；collapse / entity_budget 需要 Agent
提供场景语义参数、deep_consistency 走 LLM，聚合扫描不裸跑，只在 checkers 元数据
里如实标注 on_demand。

红线不变：只写派生缓存，绝不碰手稿或 canon.json；输出是参考信号，不是质量判定。
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from app.domains.agent_runs import canon_store
from app.domains.agent_runs.canon_service import run_canon_projection
from app.domains.agent_runs.fs_tools import FsToolError, resolve_project_root
from app.domains.agent_runs.promise_scan import DEFAULT_STALE_AFTER_CHAPTERS, promise_check
from app.domains.agent_runs.prose_scan import prose_static_scan

OBSERVATIONS_DERIVED_NAME = "observations.json"

# 文笔气味逐文件扫描的文件数上限：超出如实记 truncated，不静默丢。
_MAX_PROSE_FILES = 100
_SNIPPET_TITLE_BUDGET = 40
_CANON_DECLARATION_PATH = ".storyforge/canon/canon.json"

# severity 归一化：error 专属声明结构矛盾（blocking）；确定性文本气味最高到 warning。
_SEVERITY_NORMALIZATION = {
    "blocking": "error",
    "high": "warning",
    "medium": "warning",
    "严重": "warning",
    "高": "warning",
    "中": "warning",
    "低": "advisory",
    "low": "advisory",
    "advisory": "advisory",
}

_PROMISE_CATEGORY_LABELS = {
    "duplicate_id": "声明重复",
    "resolved_chapter": "兑现章缺失",
    "resolved_before_planted": "先收后埋",
    "due_before_planted": "期限早于埋设",
    "overdue": "逾期未回应",
    "stalled": "长期未推进",
    "cadence_gap": "节拍断档",
}


def _normalize_severity(raw: Any) -> str:
    return _SEVERITY_NORMALIZATION.get(str(raw), "advisory")


def _synthetic_id(prefix: str, parts: list[str]) -> str:
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _observation(
    *,
    obs_id: str,
    severity: str,
    title: str,
    detail: str,
    source: str,
    location: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": obs_id,
        "severity": severity,
        "title": title,
        "detail": detail,
        "source": source,
        "location": location,
    }


def _canon_observations(canon_output: dict[str, Any]) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for conflict in canon_output.get("conflicts") or []:
        category = str(conflict.get("category") or "conflict")
        if category == "single_holder":
            title = f"「{conflict.get('item')}」唯一持有冲突"
        elif category == "timeline_order":
            title = "时间线先后声明成环"
        else:
            title = f"canon 硬矛盾：{category}"
        observations.append(
            _observation(
                obs_id=str(conflict.get("id") or _synthetic_id("canon", [category, str(conflict)])),
                severity=_normalize_severity(conflict.get("severity")),
                title=title,
                detail=str(conflict.get("message") or ""),
                source=f"canon·{category}",
                location={"path": _CANON_DECLARATION_PATH},
            )
        )
    for advisory in canon_output.get("advisories") or []:
        category = str(advisory.get("category") or "advisory")
        hits = [hit for hit in (advisory.get("hits") or []) if isinstance(hit, dict)]
        location: dict[str, Any] = {"path": _CANON_DECLARATION_PATH}
        if hits and isinstance(hits[0].get("path"), str):
            location = {"path": hits[0]["path"]}
            if isinstance(hits[0].get("first_line"), int):
                location["line"] = hits[0]["first_line"]
        observations.append(
            _observation(
                obs_id=str(advisory.get("id") or _synthetic_id("canon", [category, str(advisory)])),
                severity=_normalize_severity(advisory.get("severity")),
                title=f"{advisory.get('entity') or '实体'} 声明退场后仍出场",
                detail=str(advisory.get("message") or ""),
                source=f"canon·{category}",
                location=location,
            )
        )
    return observations


def _promise_observations(promise_output: dict[str, Any]) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for layer, fallback_severity in (("conflicts", "blocking"), ("advisories", "medium")):
        for issue in promise_output.get(layer) or []:
            category = str(issue.get("category") or "promise")
            label = _PROMISE_CATEGORY_LABELS.get(category, category)
            promise_title = issue.get("title") or issue.get("promise_id") or "未命名伏笔"
            observations.append(
                _observation(
                    obs_id=str(issue.get("id") or _synthetic_id("promise", [category, str(issue)])),
                    severity=_normalize_severity(issue.get("severity") or fallback_severity),
                    title=f"伏笔「{promise_title}」{label}",
                    detail=str(issue.get("message") or ""),
                    source=f"promise·{category}",
                    location={"path": _CANON_DECLARATION_PATH},
                )
            )
    return observations


def _prose_observations(project_root: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """对项目内 Markdown 逐文件跑文笔气味；空文件 / 越界由底层拒绝，这里如实计数跳过。"""

    root = resolve_project_root(project_root)
    markdown_files = [
        path.relative_to(root).as_posix()
        for path in sorted(root.rglob("*.md"), key=lambda item: item.as_posix())
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(root).parts)
    ]
    truncated = len(markdown_files) > _MAX_PROSE_FILES
    scanned: list[str] = []
    skipped: list[str] = []
    observations: list[dict[str, Any]] = []
    for relative_path in markdown_files[:_MAX_PROSE_FILES]:
        try:
            report = prose_static_scan(project_root, relative_path)
        except FsToolError:
            skipped.append(relative_path)
            continue
        scanned.append(relative_path)
        for issue in report.get("issues") or []:
            dimension = str(issue.get("dimension") or "prose")
            snippet = str(issue.get("snippet") or "")
            title_snippet = snippet[:_SNIPPET_TITLE_BUDGET] or dimension
            suggestion = str(issue.get("suggestion") or "").strip()
            strategy = str(issue.get("revision_strategy") or "").strip()
            detail_parts = [str(issue.get("message") or "")]
            if suggestion:
                detail_parts.append(suggestion)
            if strategy:
                detail_parts.append(f"建议策略 {strategy}")
            observations.append(
                _observation(
                    obs_id=_synthetic_id("prose", [relative_path, dimension, snippet]),
                    severity=_normalize_severity(issue.get("severity")),
                    title=f"「{title_snippet}」",
                    detail=" · ".join(part for part in detail_parts if part),
                    source=f"prose·{dimension}",
                    location={"path": relative_path, "snippet": snippet},
                )
            )
    meta = {
        "files_scanned": len(scanned),
        "files_skipped": len(skipped),
        "files_truncated": truncated,
        "issue_count": len(observations),
    }
    return observations, meta


def run_observatory_scan(
    project_root: str,
    *,
    glob: str = "*.md",
    stale_after_chapters: int = DEFAULT_STALE_AFTER_CHAPTERS,
) -> dict[str, Any]:
    """聚合确定性检查器，归一化观测信号并写 observations.json 派生缓存。"""

    canon_output = run_canon_projection(project_root, glob=glob, refresh=True)
    promise_output = promise_check(project_root, stale_after_chapters=stale_after_chapters)
    prose_observations, prose_meta = _prose_observations(project_root)

    observations = [
        *_canon_observations(canon_output),
        *_promise_observations(promise_output),
        *prose_observations,
    ]
    counts = {
        "error": sum(1 for item in observations if item["severity"] == "error"),
        "warning": sum(1 for item in observations if item["severity"] == "warning"),
        "advisory": sum(1 for item in observations if item["severity"] == "advisory"),
        "total": len(observations),
    }
    checkers = [
        {
            "key": "canon",
            "tool": "project.canon",
            "status": "ran",
            "conflict_count": canon_output.get("conflict_count"),
            "advisory_count": canon_output.get("advisory_count"),
            "entity_count": canon_output.get("entity_count"),
        },
        {
            "key": "promise",
            "tool": "project.promise_check",
            "status": "ran",
            "conflict_count": promise_output.get("conflict_count"),
            "advisory_count": promise_output.get("advisory_count"),
            "promise_count": promise_output.get("promise_count"),
            "current_chapter": promise_output.get("current_chapter"),
        },
        {"key": "prose", "tool": "project.prose_check", "status": "ran", **prose_meta},
        {
            "key": "consistency",
            "tool": "project.consistency",
            "status": "on_demand",
            "reason": "机械观察不下结论，Agent 内按需触发。",
        },
        {
            "key": "collapse",
            "tool": "project.collapse_check",
            "status": "on_demand",
            "reason": "需要 Agent 提供场景节拍等语义参数，裸跑无信号。",
        },
        {
            "key": "entity_budget",
            "tool": "project.entity_budget_check",
            "status": "on_demand",
            "reason": "需要 Agent 提供新实体清单，裸跑无信号。",
        },
        {
            "key": "deep_consistency",
            "tool": "project.deep_consistency",
            "status": "on_demand",
            "reason": "语义评审走 LLM，永远按需触发，不进保存重扫。",
        },
    ]
    payload = {
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "observations": observations,
        "counts": counts,
        "checkers": checkers,
        "note": "确定性参考信号（无 LLM）：advisory 需结合原文核实，不是质量判定。",
    }
    canon_store.write_derived(project_root, OBSERVATIONS_DERIVED_NAME, payload)
    return payload
