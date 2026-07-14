from __future__ import annotations

from typing import Any, Protocol

from app.domains.agent_runs._text import compact_text as _compact_text
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.ide import review_reasoning
from app.domains.ide.review_reasoning import HeuristicReviewReasoner, LlmReviewReasoner, ReviewSubagentResult
from app.domains.ide.review_skills import (
    REVIEW_SKILLS,
    review_context_summary,
    suggested_actions_for_review,
)


class ReviewSubagentExecutor(Protocol):
    def run(self, role: str, payload: dict[str, Any], *, tool_name: str) -> dict[str, Any]: ...


def _build_multi_agent_review_report_with_executor(
    executor: ReviewSubagentExecutor,
    *,
    file_path: str,
    content: str,
    context_bundle: dict[str, Any] | None,
    user_message: str,
    requested_role_hints: list[str] | None = None,
    requested_role_mentions: list[str] | None = None,
) -> tuple[dict[str, Any], list[AgentToolTrace]]:
    context = review_context_summary(context_bundle)
    role_hints = requested_role_hints or []
    role_mentions = requested_role_mentions or []
    paragraphs = [paragraph.strip() for paragraph in content.splitlines() if paragraph.strip()]
    reasoner = _select_review_reasoner()
    subagent_results = reasoner.review_all(content=content, paragraphs=paragraphs, context_bundle=context_bundle)
    results_by_key = {key: result for key, result in zip(review_reasoning.REVIEW_AGENT_KEYS, subagent_results, strict=True)}

    plot_issues = _assign_issue_ids(
        "plot",
        executor.run("plot_reviewer", {"result": results_by_key["plot"]}, tool_name="file.review")["issues"],
    )
    character_issues = _assign_issue_ids(
        "character",
        executor.run("character_reviewer", {"result": results_by_key["character"]}, tool_name="file.review")["issues"],
    )
    prose_issues = _assign_issue_ids(
        "prose",
        executor.run("prose_reviewer", {"result": results_by_key["prose"]}, tool_name="file.review")["issues"],
    )
    continuity = executor.run(
        "continuity_reviewer",
        {"content": content, "context_bundle": context_bundle},
        tool_name="file.review",
    )
    issues = [*plot_issues, *character_issues, *prose_issues, *_assign_issue_ids("continuity", continuity["issues"])]
    suggested_actions = suggested_actions_for_review(
        plot_issues=plot_issues,
        character_issues=character_issues,
        prose_issues=prose_issues,
    )
    if continuity["issues"]:
        suggested_actions.append("先核对设定、伏笔、人物关系和时间线，再处理语言层润色。")
    report = {
        "kind": "review_report",
        "file_path": file_path,
        "user_goal": user_message,
        "mode": _review_report_mode(subagent_results),
        "requested_role_hints": role_hints,
        "requested_role_mentions": role_mentions,
        "context": context,
        "agent_findings": {
            "plot": _agent_finding("plot", results_by_key["plot"]),
            "character": _agent_finding("character", results_by_key["character"]),
            "prose": _agent_finding("prose", results_by_key["prose"]),
            "continuity": {
                "agent": "continuity-agent",
                "focus": "设定、伏笔、人物关系、时间线和前后文事实冲突",
                "issue_count": len(continuity["issues"]),
                "mode": "heuristic",
            },
        },
        "issues": issues,
        "suggested_actions": suggested_actions,
    }
    traces = [
        AgentToolTrace(
            tool_name="subagent.plot_reviewer",
            status="completed",
            input_summary={
                "content_chars": len(content),
                "requested_role_hints": role_hints,
                "explicitly_requested": "plot_reviewer" in role_hints,
            },
            output_summary=_subagent_output_summary(report, "plot"),
        ),
        AgentToolTrace(
            tool_name="subagent.character_reviewer",
            status="completed",
            input_summary={
                "content_chars": len(content),
                "requested_role_hints": role_hints,
                "explicitly_requested": "character_reviewer" in role_hints,
            },
            output_summary=_subagent_output_summary(report, "character"),
        ),
        AgentToolTrace(
            tool_name="subagent.prose_reviewer",
            status="completed",
            input_summary={
                "content_chars": len(content),
                "requested_role_hints": role_hints,
                "explicitly_requested": "prose_reviewer" in role_hints,
            },
            output_summary=_subagent_output_summary(report, "prose"),
        ),
        AgentToolTrace(
            tool_name="subagent.continuity_reviewer",
            status="completed",
            input_summary={
                "content_chars": len(content),
                "context_file_count": context["file_count"],
                "requested_role_hints": role_hints,
                "explicitly_requested": "continuity_reviewer" in role_hints,
            },
            output_summary=_subagent_output_summary(report, "continuity"),
        ),
        AgentToolTrace(
            tool_name="subagent.synthesizer",
            status="completed",
            input_summary={"issue_count": len(issues), "requested_role_hints": role_hints},
            output_summary={"suggested_action_count": len(suggested_actions), "strategy": "deterministic_merge"},
        ),
    ]
    return report, traces


def _review_subagent_handler(key: str):
    def handler(payload: dict[str, Any]) -> dict[str, Any]:
        result = payload.get("result")
        if not isinstance(result, ReviewSubagentResult):
            raise AgentOrchestrationError(f"{key} 子代理缺少 ReviewSubagentResult。")
        return {"issues": result.issues}

    return handler


def _continuity_subagent_handler(payload: dict[str, Any]) -> dict[str, Any]:
    content = _compact_text(payload.get("content"), limit=120000)
    issues: list[dict[str, str]] = []
    if any(keyword in content for keyword in ("昨天才第一次", "第十天", "前后矛盾", "不一致")):
        issues.append(
            {
                "agent": "continuity-agent",
                "severity": "medium",
                "code": "continuity.timeline_conflict_signal",
                "message": "正文存在时间线或前后文冲突信号，建议核对章节事实。",
                "evidence": _compact_text(content, limit=120),
            }
        )
    return {"issues": issues}


def _assign_issue_ids(category: str, issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {
            **issue,
            "id": f"{category}-{index}",
            "category": category,
            "suggested_action": _issue_suggested_action(category, issue),
        }
        for index, issue in enumerate(issues, start=1)
    ]


def _issue_suggested_action(category: str, issue: dict[str, str]) -> str:
    code = issue.get("code", "")
    if category == "plot":
        if "hook" in code:
            return "重写章尾最后一段，加入新的悬念、阻碍或行动压力。"
        if "conflict" in code:
            return "补一个明确的对抗、阻碍或代价，让本章目标被迫推进。"
        return "补清章节目标、冲突推进和转折，避免只交代状态。"
    if category == "character":
        if "context" in code:
            return "先补充或引用人物小传，再校准行动动机和关系称谓。"
        return "为角色选择增加可见动机，用动作或对白证明其决定。"
    if category == "prose":
        if "paragraph" in code:
            return "拆分长段落，调整信息密度，保证移动端阅读节奏。"
        return "把解释性句子改成动作、对话或感官细节。"
    if category == "continuity":
        return "核对设定、伏笔、人物关系和时间线，先修正事实冲突。"
    return "按该问题做定向修订，并保持原有事实连续。"


def _select_review_reasoner() -> review_reasoning.ReviewReasoner:
    missing = review_reasoning.missing_book_generation_env()
    if missing:
        return HeuristicReviewReasoner()
    return LlmReviewReasoner(review_reasoning.resolved_llm_env())


def _review_report_mode(results: list[ReviewSubagentResult]) -> str:
    modes = {result.mode for result in results}
    if modes == {"llm"}:
        return "llm"
    if "llm" in modes:
        return "mixed"
    if any(result.degraded_reason for result in results):
        return "llm_failed"
    return "heuristic_only"


def _agent_finding(key: str, result: ReviewSubagentResult) -> dict[str, Any]:
    finding: dict[str, Any] = {
        "agent": REVIEW_SKILLS[key].agent,
        "focus": REVIEW_SKILLS[key].focus,
        "issue_count": len(result.issues),
        "mode": result.mode,
    }
    if result.model is not None:
        finding["model"] = result.model
    if result.latency_ms is not None:
        finding["latency_ms"] = result.latency_ms
    if result.degraded_reason is not None:
        finding["degraded_reason"] = result.degraded_reason
    return finding


def _subagent_output_summary(report: dict[str, Any], key: str) -> dict[str, Any]:
    finding = report["agent_findings"][key]
    summary: dict[str, Any] = {
        "issue_count": finding["issue_count"],
        "mode": finding["mode"],
    }
    for optional_key in ("model", "latency_ms", "degraded_reason"):
        if optional_key in finding:
            summary[optional_key] = finding[optional_key]
    return summary


def _review_report_summary(report: dict[str, Any]) -> str:
    issues = report.get("issues") if isinstance(report.get("issues"), list) else []
    findings = report.get("agent_findings") if isinstance(report.get("agent_findings"), dict) else {}
    plot = _agent_issue_count(findings, "plot")
    character = _agent_issue_count(findings, "character")
    prose = _agent_issue_count(findings, "prose")
    continuity = _agent_issue_count(findings, "continuity")
    summary = (
        f"多视角审稿完成：发现 {len(issues)} 个问题。"
        f"剧情 {plot} 个，人物 {character} 个，文风节奏 {prose} 个，连续性 {continuity} 个。"
    )
    mode = report.get("mode")
    if mode == "heuristic_only":
        return f"{summary} 未配置 LLM，本轮为启发式预扫，非模型审稿。"
    if mode == "llm_failed":
        degraded = _degraded_review_agents(findings)
        suffix = f" 失败视角：{', '.join(degraded)}。" if degraded else ""
        return f"{summary} 已配置 LLM，但全部子代理调用失败，已整体降级为启发式预扫。{suffix}"
    if mode == "mixed":
        degraded = _degraded_review_agents(findings)
        suffix = f" 降级视角：{', '.join(degraded)}。" if degraded else ""
        return f"{summary} 部分 LLM 子代理失败，已按单项降级为启发式预扫。{suffix}"
    return summary


def _agent_issue_count(findings: dict[str, Any], key: str) -> int:
    item = findings.get(key)
    count = item.get("issue_count") if isinstance(item, dict) else None
    return count if isinstance(count, int) else 0


def _degraded_review_agents(findings: dict[str, Any]) -> list[str]:
    degraded: list[str] = []
    for key in review_reasoning.REVIEW_AGENT_KEYS:
        item = findings.get(key)
        if isinstance(item, dict) and item.get("mode") == "heuristic" and item.get("degraded_reason"):
            degraded.append(str(item.get("agent") or key))
    return degraded


build_multi_agent_review_report_with_executor = _build_multi_agent_review_report_with_executor
review_subagent_handler = _review_subagent_handler
continuity_subagent_handler = _continuity_subagent_handler
review_report_summary = _review_report_summary
