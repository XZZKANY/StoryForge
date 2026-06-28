from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import TextIO

from app.domains.book_runs.book_generation_metrics import _evidence_summary, _result_summary
from app.domains.book_runs.book_generation_preflight import _assert_preflight
from app.domains.book_runs.errors import BookGenerationPreflightError


def main(
    argv: list[str] | None = None,
    *,
    session_factory: Callable[[], object] | None = None,
    runner: Callable[..., object],
    output: TextIO | None = None,
    error: TextIO | None = None,
    env: Mapping[str, str | None] | None = None,
) -> int:
    """命令行入口：执行 真实 LLM 整书生成并输出脱敏摘要。"""

    parser = argparse.ArgumentParser(description="运行 StoryForge 真实 LLM 整书生成。")
    parser.add_argument("--chapter-count", type=int, required=True)
    parser.add_argument("--token-budget", type=int, required=True)
    parser.add_argument("--target-word-count", type=int, default=None)
    parser.add_argument("--chapter-word-count-min", type=int, default=600)
    parser.add_argument("--chapter-word-count-max", type=int, default=1600)
    parser.add_argument("--summary-output", type=str, default=None)
    args = parser.parse_args(argv)
    out = sys.stdout if output is None else output
    err = sys.stderr if error is None else error
    source = os.environ if env is None else env
    try:
        _assert_preflight(
            source,
            args.chapter_count,
            args.token_budget,
            args.target_word_count,
            args.chapter_word_count_min,
            args.chapter_word_count_max,
        )
    except BookGenerationPreflightError as exc:
        print(str(exc), file=err)
        return 2
    if session_factory is None:
        from app.db.session import SessionLocal

        session_factory = SessionLocal
    try:
        with session_factory() as session:
            result = runner(
                session,
                chapter_count=args.chapter_count,
                token_budget=args.token_budget,
                target_word_count=args.target_word_count,
                chapter_word_count_min=args.chapter_word_count_min,
                chapter_word_count_max=args.chapter_word_count_max,
                env=source,
            )
    except BookGenerationPreflightError as exc:
        print(str(exc), file=err)
        return 2
    except Exception as exc:
        print(f"真实 LLM 整书生成失败：{exc}", file=err)
        return 1
    summary = _result_summary(result)
    if args.summary_output:
        evidence_summary = _evidence_summary(
            result,
            target_word_count=args.target_word_count,
            chapter_word_count_min=args.chapter_word_count_min,
            chapter_word_count_max=args.chapter_word_count_max,
        )
        summary_path = Path(args.summary_output)
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(evidence_summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), file=out)
    return 0
