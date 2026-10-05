"""Deliver every selected issue without leaking the unselected report channel."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from app.common.redaction import redact_sensitive_text
from app.domains.agent_runs.errors import AgentOrchestrationError

INSTRUCTION_BUDGET = 4000


def compose_scoped_instruction(blocks: list[str], issues: list[dict[str, Any]], actions: list[str]) -> str:
    suffix = "请只处理上述有效审稿范围内的问题，并保持原有事实连续。"
    headers = []
    for index, issue in enumerate(issues, start=1):
        label = issue.get("id") or issue.get("agent") or "review"
        headers.append(
            f"{index}. [{label}/{issue.get('category') or 'review'}/{issue.get('severity') or 'info'}] "
            f"{issue.get('message') or '未命名问题'}"
            + (f" 建议：{issue['suggested_action']}" if issue.get("suggested_action") else "")
        )
    review = "上一轮多视角审稿报告（已按本轮指令筛选范围）：\n有效问题：\n" + "\n".join(headers)
    if actions:
        review += "\n建议：\n" + "\n".join(actions)
    mandatory = "\n\n".join([*blocks, review, suffix]) if issues or actions else "\n\n".join(blocks)
    available = INSTRUCTION_BUDGET - len(mandatory)
    if available < 0:
        raise AgentOrchestrationError("修订范围超过指令预算，请缩短指令或分批选择审稿问题；未生成补丁。")
    if not issues:
        return _bounded_instruction(mandatory)
    # Reserve each issue's own quote slot; a long early quote cannot consume
    # another issue's identity, message or action. Only evidence excerpts shrink.
    quote_budget = min(320, available // len(issues))
    lines = []
    for header, issue in zip(headers, issues, strict=True):
        evidence = issue.get("evidence")
        if isinstance(evidence, str) and evidence:
            label = " 证据："
            marker = "（证据摘录已截断）"
            if len(label) + len(evidence) <= quote_budget:
                header += label + evidence
            elif quote_budget > len(label) + len(marker):
                header += label + evidence[: quote_budget - len(label) - len(marker)] + marker
            else:
                raise AgentOrchestrationError("修订范围没有足够证据预算，请分批选择审稿问题；未生成补丁。")
        lines.append(header)
    review = "上一轮多视角审稿报告（已按本轮指令筛选范围）：\n有效问题：\n" + "\n".join(lines)
    if actions:
        review += "\n建议：\n" + "\n".join(actions)
    return _bounded_instruction("\n\n".join([*blocks, review, suffix]))


def _bounded_instruction(text: str) -> str:
    redacted = redact_sensitive_text(text)
    if len(redacted) > INSTRUCTION_BUDGET:
        raise AgentOrchestrationError("脱敏后的修订范围超过指令预算，请分批选择审稿问题；未生成补丁。")
    return redacted


def scoped_revise_context_bundle(bundle: dict[str, Any] | None) -> dict[str, Any] | None:
    if bundle is None:
        return None
    files = bundle.get("files")
    # Only the backend-owned synthetic report is replaced by the selected
    # instruction. Preserve real project files, even when their kind is mislabeled.
    retained = (
        [
            item
            for item in files
            if not (isinstance(item, dict) and item.get("path") == "storyforge://llm-context/review_report")
        ]
        if isinstance(files, list)
        else []
    )
    budget = bundle.get("budget")
    return {
        **bundle,
        "files": retained,
        **(
            {
                "budget": {
                    **budget,
                    "file_count": len(retained),
                    "char_count": sum(len(str(item.get("excerpt") or "")) for item in retained),
                }
            }
            if isinstance(budget, dict)
            else {}
        ),
    }


def verify_review_source(report: dict[str, Any] | None, file_path: str, content: str, project_root: str | None) -> None:
    if not report or not report.get("content_sha256"):
        return  # Legacy reports are not upgraded to verified sources by this adapter.
    reported = report.get("file_path")
    if not isinstance(reported, str):
        raise AgentOrchestrationError("审稿来源缺失，请重新审稿后修订。")
    try:
        root = Path(project_root).resolve() if project_root else None
        paths = [Path(reported), Path(file_path)]
        resolved = [(root / path if root and not path.is_absolute() else path).resolve() for path in paths]
        same_file = resolved[0] == resolved[1] and (root is None or all(path.is_relative_to(root) for path in resolved))
    except (OSError, ValueError):
        same_file = False
    if not same_file or report["content_sha256"] != hashlib.sha256(content.encode("utf-8")).hexdigest():
        raise AgentOrchestrationError("审稿报告不是当前文件的当前版本，请重新审稿后修订。")
