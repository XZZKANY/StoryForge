"""Shared verdict helpers for narrative gates."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class GateVerdict:
    status: str
    issues: list[dict[str, str]] = field(default_factory=list)


def issue(
    dimension: str,
    message: str,
    *,
    severity: str = "高",
    suggestion: str = "按叙事计划重写该段。",
    revision_strategy: str = "regenerate",
    snippet: str = "",
) -> dict[str, str]:
    return {
        "dimension": dimension,
        "severity": severity,
        "snippet": snippet,
        "message": message,
        "suggestion": suggestion,
        "revision_strategy": revision_strategy,
    }


def verdict_from_issues(issues: list[dict[str, str]], *, warn_only: bool = False) -> GateVerdict:
    if issues and warn_only:
        return GateVerdict(status="warn", issues=issues)
    if issues:
        return GateVerdict(status="fail", issues=issues)
    return GateVerdict(status="pass", issues=[])
