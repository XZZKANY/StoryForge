from __future__ import annotations

import json
import os
from pathlib import Path

import app.models  # noqa: F401
from app.db.session import SessionLocal
from app.domains.book_runs.book_generation import run_book_generation

OUT_DIR = Path(__file__).resolve().parents[2] / ".codex" / "real-llm-smoke"


def _redact(value: str) -> str:
    return value if value else value


def main() -> int:
    chapter_count = int(os.environ.get("SMOKE_CHAPTER_COUNT", "1"))
    token_budget = int(os.environ.get("SMOKE_TOKEN_BUDGET", "60000"))
    # 生成用的 reasoning 模型（gpt-5.4 等）在本网关 ~90s 墙钟上限下，
    # 一旦 Judge 需要描述违规就会在输出阶段被断连，静默返回空列表（伪通过）。
    # gpt-5.2-openai-compact 实测在 clean(4.6s)/有违规(9.7s) 两种情况都能稳定返回，
    # 因此 Judge 默认走它；显式设置 STORYFORGE_JUDGE_LLM_MODEL 可覆盖。
    os.environ.setdefault("STORYFORGE_JUDGE_LLM_MODEL", "gpt-5.2-openai-compact")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as session:
        result = run_book_generation(
            session,
            chapter_count=chapter_count,
            token_budget=token_budget,
        )
        book_md = str(result.markdown_artifact.payload["content"])
        audit = result.audit_artifact.payload

        (OUT_DIR / "book.md").write_text(book_md, encoding="utf-8")
        (OUT_DIR / "audit_report.json").write_text(
            json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        summary = {
            "book_run_id": result.book_run.id,
            "status": result.book_run.status,
            "chapter_count": result.chapter_count,
            "tokens_used": result.book_run.tokens_used,
            "provider": os.environ.get("STORYFORGE_LLM_PROVIDER"),
            "model": os.environ.get("STORYFORGE_LLM_MODEL"),
            "book_md_chars": len(book_md),
            "book_md_path": str(OUT_DIR / "book.md"),
            "audit_path": str(OUT_DIR / "audit_report.json"),
        }
        print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
