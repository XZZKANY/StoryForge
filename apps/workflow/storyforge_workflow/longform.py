from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from time import sleep

from storyforge_workflow.prompts import NarrativeContext, build_longform_segment_prompt
from storyforge_workflow.provider_client import generate_text


@dataclass(frozen=True)
class LongformGenerationPlan:
    """长文生成计划，按章节分段请求模型并把正文增量落盘。"""

    title: str
    target_chars: int = 200_000
    segment_chars: int = 2_000
    max_segments: int = 140
    retry_count: int = 2
    retry_sleep_seconds: float = 1.0
    retry_backoff_multiplier: float = 1.0
    max_retry_sleep_seconds: float = 60.0

    def __post_init__(self) -> None:
        if not self.title.strip():
            raise ValueError("长文标题不能为空。")
        if self.target_chars <= 0:
            raise ValueError("目标字数必须大于 0。")
        if self.segment_chars < 200:
            raise ValueError("单段目标字数不能小于 200。")
        if self.max_segments <= 0:
            raise ValueError("最大分段数必须大于 0。")
        if self.retry_count < 0:
            raise ValueError("重试次数不能小于 0。")
        if self.retry_sleep_seconds < 0:
            raise ValueError("重试等待秒数不能小于 0。")
        if self.retry_backoff_multiplier < 1:
            raise ValueError("重试退避倍率不能小于 1。")
        if self.max_retry_sleep_seconds < 0:
            raise ValueError("最大重试等待秒数不能小于 0。")


def generate_longform_article(
    plan: LongformGenerationPlan,
    output_path: Path,
    *,
    premise: str,
    provider=generate_text,
    narrative_context: NarrativeContext | None = None,
) -> dict[str, int | str]:
    """生成长文并增量写入 Markdown 文件，返回实际字数和分段数。

    narrative_context 可选注入角色/风格/节奏/连续性约束；缺省时退化为仅 premise 驱动。
    """

    base_context = narrative_context or NarrativeContext()
    base_context = replace(base_context, premise=premise or base_context.premise)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    existing = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
    if not existing.strip():
        output_path.write_text(f"# {plan.title}\n\n", encoding="utf-8")
        existing = output_path.read_text(encoding="utf-8")

    generated_chars = count_article_chars(existing)
    segment_index = _detect_next_segment_index(existing)
    previous_summary = _tail_summary(existing)

    while generated_chars < plan.target_chars and segment_index <= plan.max_segments:
        remaining = plan.target_chars - generated_chars
        prompt = _build_segment_prompt(
            plan=plan,
            context=base_context,
            segment_index=segment_index,
            remaining_chars=remaining,
            previous_summary=previous_summary,
        )
        segment = _call_with_retry(provider, prompt, plan)
        cleaned = _clean_segment(segment)
        cleaned_chars = count_article_chars(cleaned)
        minimum_chars = max(120, min(plan.segment_chars // 3, max(120, remaining // 3)))
        if cleaned_chars < minimum_chars:
            raise RuntimeError(f"第 {segment_index} 段返回过短，只有 {len(cleaned)} 字符。")

        with output_path.open("a", encoding="utf-8") as file:
            file.write(f"\n\n## 第 {segment_index:03d} 段\n\n{cleaned}\n")

        generated_chars += cleaned_chars
        previous_summary = _tail_summary(cleaned)
        segment_index += 1

    if generated_chars < plan.target_chars:
        raise RuntimeError(
            f"达到最大分段数 {plan.max_segments} 后仍未达到目标字数：{generated_chars}/{plan.target_chars}。"
        )

    return {
        "title": plan.title,
        "output_path": str(output_path),
        "target_chars": plan.target_chars,
        "actual_chars": generated_chars,
        "segments": segment_index - 1,
    }


def count_article_chars(content: str) -> int:
    """统计正文字符数，排除 Markdown 标题、空白和分段标题。"""

    total = 0
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        total += len(stripped)
    return total


def _build_segment_prompt(
    *,
    plan: LongformGenerationPlan,
    context: NarrativeContext,
    segment_index: int,
    remaining_chars: int,
    previous_summary: str,
) -> str:
    segment_target = min(plan.segment_chars, remaining_chars)
    segment_context = replace(context, previous_summary=previous_summary)
    return build_longform_segment_prompt(
        segment_context,
        title=plan.title,
        segment_index=segment_index,
        segment_target_chars=segment_target,
        remaining_chars=remaining_chars,
    )


def _call_with_retry(provider: Callable[[str], str], prompt: str, plan: LongformGenerationPlan) -> str:
    """对单段模型调用执行可配置重试，降低长任务被临时错误中断的概率。"""

    last_error: Exception | None = None
    delay = plan.retry_sleep_seconds
    for attempt in range(plan.retry_count + 1):
        try:
            return provider(prompt)
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt < plan.retry_count:
                sleep(min(delay, plan.max_retry_sleep_seconds))
                delay *= plan.retry_backoff_multiplier
    raise RuntimeError(f"长文生成调用模型失败：{last_error}") from last_error


def _clean_segment(segment: str) -> str:
    return "\n".join(line.rstrip() for line in segment.strip().splitlines() if line.strip())


def _tail_summary(text: str, limit: int = 600) -> str:
    compact = " ".join(line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#"))
    return compact[-limit:]


def _detect_next_segment_index(content: str) -> int:
    count = sum(1 for line in content.splitlines() if line.startswith("## 第 ") and line.endswith(" 段"))
    return count + 1


def main(argv: list[str] | None = None) -> int:
    """通过命令行入口执行可恢复的 20w 长文生成链路。"""

    parser = argparse.ArgumentParser(description="通过 StoryForge workflow 生成长篇文章")
    parser.add_argument("--title", required=True, help="文章标题")
    parser.add_argument("--premise", required=True, help="文章设定和写作要求")
    parser.add_argument("--output", required=True, type=Path, help="Markdown 输出路径")
    parser.add_argument("--target-chars", type=int, default=200_000, help="目标正文字符数，默认 200000")
    parser.add_argument("--segment-chars", type=int, default=2_000, help="单段目标字符数，默认 2000")
    parser.add_argument("--max-segments", type=int, default=140, help="最大分段数，默认 140")
    parser.add_argument("--retry-count", type=int, default=2, help="单段 provider 调用失败后的重试次数")
    parser.add_argument("--retry-sleep-seconds", type=float, default=1.0, help="首次重试等待秒数")
    parser.add_argument("--retry-backoff-multiplier", type=float, default=1.0, help="重试等待指数退避倍率")
    parser.add_argument("--max-retry-sleep-seconds", type=float, default=60.0, help="单次重试最大等待秒数")
    args = parser.parse_args(argv)

    plan = LongformGenerationPlan(
        title=args.title,
        target_chars=args.target_chars,
        segment_chars=args.segment_chars,
        max_segments=args.max_segments,
        retry_count=args.retry_count,
        retry_sleep_seconds=args.retry_sleep_seconds,
        retry_backoff_multiplier=args.retry_backoff_multiplier,
        max_retry_sleep_seconds=args.max_retry_sleep_seconds,
    )
    result = generate_longform_article(plan, args.output, premise=args.premise, provider=generate_text)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
