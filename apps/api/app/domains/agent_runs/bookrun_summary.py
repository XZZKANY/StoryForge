from __future__ import annotations

from typing import Any


def _bookrun_chapter_plan_summary(command_args: dict[str, Any]) -> str:
    chapter_budget = command_args.get("chapter_budget")
    if isinstance(chapter_budget, int) and chapter_budget > 0:
        return f"生成最多 {chapter_budget} 章"
    return "按锁定蓝图继续生成下一批章节"


def _bookrun_budget_summary(command_args: dict[str, Any]) -> str:
    parts: list[str] = []
    token_budget = command_args.get("token_budget")
    time_budget_sec = command_args.get("time_budget_sec")
    if isinstance(token_budget, int) and token_budget > 0:
        parts.append(f"{token_budget} tokens")
    if isinstance(time_budget_sec, int) and time_budget_sec > 0:
        parts.append(f"{time_budget_sec} 秒")
    return "，".join(parts) if parts else "使用系统默认预算"


def _bookrun_budget_details(command_args: dict[str, Any]) -> dict[str, int | None | bool]:
    return {
        "token_budget": command_args.get("token_budget") if isinstance(command_args.get("token_budget"), int) else None,
        "time_budget_sec": command_args.get("time_budget_sec") if isinstance(command_args.get("time_budget_sec"), int) else None,
        "chapter_budget": command_args.get("chapter_budget") if isinstance(command_args.get("chapter_budget"), int) else None,
        "uses_default_budget": not any(
            isinstance(command_args.get(key), int) for key in ("token_budget", "time_budget_sec", "chapter_budget")
        ),
    }


def _bookrun_risk_summary(command_args: dict[str, Any]) -> list[str]:
    risks: list[str] = []
    token_budget = command_args.get("token_budget")
    time_budget_sec = command_args.get("time_budget_sec")
    chapter_budget = command_args.get("chapter_budget")
    if not isinstance(token_budget, int):
        risks.append("未设置 token_budget，可能使用系统默认预算")
    elif token_budget >= 8000:
        risks.append("token_budget 较高，可能产生更长运行时间和更高成本")
    if not isinstance(chapter_budget, int):
        risks.append("未设置 chapter_budget，将按锁定蓝图继续生成")
    elif chapter_budget >= 6:
        risks.append("chapter_budget 较高，建议确认章节范围")
    if isinstance(time_budget_sec, int) and time_budget_sec >= 1800:
        risks.append("time_budget_sec 较长，运行会停留在后台")
    risks.append("写作任务以 managed 模式运行，不会写入当前 Desktop 草稿或 pending patch")
    return risks
