"""场景承重静态检查：对单个稿件产出 advisory 观察信号。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.domains.agent_runs.fs_tools import (
    FsToolError,
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

_MAX_FILE_BYTES = 512_000
_PROCESS_ONLY_BEATS = ["到场", "取证", "保存", "转场"]
_INVESTIGATION_BUCKETS = (
    ("来到", "到达", "进入", "档案室", "码头", "灯塔", "现场"),
    ("询问", "追问", "问", "管理员", "证人"),
    ("查看", "翻看", "调查", "记录", "账本", "登记表", "线索", "证据"),
    ("收进", "保存", "带走", "放进", "口袋"),
    ("离开", "转场", "赶往", "回到"),
)


def _issue(rule: str, severity: str, detail: str, *, snippet: str = "") -> dict[str, str]:
    return {
        "rule": rule,
        "severity": severity,
        "detail": detail,
        "snippet": snippet,
    }


def _process_only(beats: Sequence[str]) -> tuple[bool, list[str]]:
    normalized = [beat.strip() for beat in beats if beat.strip()]
    return normalized == _PROCESS_ONLY_BEATS, normalized


def _investigation_template_hits(text: str) -> list[str]:
    return [
        next(term for term in bucket if term in text)
        for bucket in _INVESTIGATION_BUCKETS
        if any(term in text for term in bucket)
    ]


def _summary(status: str, issues: list[dict[str, str]]) -> str:
    if status == "pass":
        return "场景承重静态检查未发现风险信号；这是 advisory 参考，不是质量判定。"
    signals = "、".join(f"{item['rule']}（{item['severity']}）" for item in issues)
    return f"场景承重静态检查发现 {len(issues)} 个 advisory 信号：{signals}；请结合原文核实，不是质量判定。"


def collapse_scan(
    project_root: str,
    path: str,
    *,
    beats: Sequence[str] | None = None,
    emotion_before: str | None = None,
    emotion_after: str | None = None,
    irreversible_consequence: str | None = None,
    deletable: bool | None = None,
) -> dict[str, Any]:
    """读取项目内正文，按计划中的确定性规则判断本场是否承重。"""

    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"不是文件：{path}")
    target_relative = target.relative_to(root).as_posix()
    content = _read_text(target, max_bytes=_MAX_FILE_BYTES)
    if not content.strip():
        raise FsToolError(f"文件没有可检查的内容：{path}")

    issues: list[dict[str, str]] = []
    if beats is not None:
        is_process_only, normalized_beats = _process_only(beats)
        if is_process_only:
            issues.append(
                _issue(
                    "process_only",
                    "中",
                    "场景只有到场、取证、保存、转场流程，没有承重变化。",
                    snippet="-".join(normalized_beats),
                )
            )

    normalized_before = emotion_before.strip() if emotion_before is not None else None
    normalized_after = emotion_after.strip() if emotion_after is not None else None
    if normalized_before and normalized_after and normalized_before == normalized_after:
        issues.append(
            _issue(
                "emotion_unchanged",
                "低",
                "场景前后情绪相同，没有可见情绪变化。",
                snippet=normalized_before,
            )
        )

    consequence = irreversible_consequence.strip() if irreversible_consequence is not None else None
    if irreversible_consequence is not None and not consequence:
        issues.append(
            _issue(
                "no_irreversible_consequence",
                "低",
                "显式观察结果为空：本场没有不可逆后果。",
            )
        )

    if deletable is True:
        issues.append(
            _issue(
                "deletable",
                "低",
                "本场被标记为可删除，删除后主线仍可成立。",
            )
        )

    template_hits = _investigation_template_hits(content)
    if len(template_hits) >= 3 and not consequence:
        issues.append(
            _issue(
                "investigation_template",
                "中",
                "正文命中至少三个调查动作桶，且没有不可逆后果；这是用不可逆后果近似原版推进三信号的降级判定。",
                snippet="-".join(template_hits),
            )
        )

    status = "warn" if issues else "pass"
    verdict = {"status": status, "issues": issues}
    return {
        "path": target_relative,
        "verdict": verdict,
        "summary": _summary(status, issues),
    }
