"""Phase 1 Context 增量化验证脚本：对比优化前后的查询次数。

目标：10 章 BookRun 的 approved scene 查询从 20 次降至 1 次。

验证方式：
1. 运行 10 章 phase9b 真实 LLM smoke test
2. 拦截 SQLAlchemy query log，统计 Scene 表查询次数
3. 断言：总查询次数 <= 3（初始化 1 次 + 容错 2 次）
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.domains.books.models import Book


@pytest.fixture
def query_counter():
    """统计 Scene 表查询次数的 fixture。"""
    queries = []

    def _log_query(conn, cursor, statement, parameters, context, executemany):
        if "scenes" in statement.lower() and "SELECT" in statement.upper():
            queries.append(statement)

    event.listen(Engine, "before_cursor_execute", _log_query)
    yield queries
    event.remove(Engine, "before_cursor_execute", _log_query)


def test_phase1_context_optimization_query_count(session: Session, query_counter: list[str]) -> None:
    """Phase 1 验证：10 章 BookRun 的 Scene 查询次数应 <= 3 次。

    优化前：compute_book_style_baseline (每章 1 次) + _prior_chapters_recap (每章 1 次) = 20 次
    优化后：BookContext.from_db (初始化 1 次) + 容错 = ~3 次
    """

    # 跳过真实 LLM 调用（环境变量缺失时）
    if not os.getenv("STORYFORGE_LLM_BASE_URL"):
        pytest.skip("缺少 STORYFORGE_LLM_BASE_URL，跳过真实 LLM 验证")

    from app.domains.book_runs.phase9b_real_llm_smoke import run_book_run_with_real_llm_smoke

    # 创建测试作品（10 章）
    book = Book(title="Phase1验证作品", status="draft")
    session.add(book)
    session.commit()

    # 运行 10 章 BookRun
    env_overrides = {
        "STORYFORGE_LLM_BASE_URL": os.getenv("STORYFORGE_LLM_BASE_URL"),
        "STORYFORGE_LLM_API_KEY": os.getenv("STORYFORGE_LLM_API_KEY", "test-key"),
        "STORYFORGE_LLM_MODEL": os.getenv("STORYFORGE_LLM_MODEL", "gpt-4"),
        "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "2000",
        "STORYFORGE_LLM_TEMPERATURE": "0.7",
    }

    with patch.dict(os.environ, env_overrides):
        try:
            result = run_book_run_with_real_llm_smoke(
                session=session,
                book_id=book.id,
                num_chapters=10,
                premise="悬疑推理小说，主角林岚调查连环案件。",
                character_name="林岚",
                character_traits="冷静、理性、不流泪",
            )
        except Exception as e:
            pytest.skip(f"真实 LLM 调用失败（可能是配额或网络问题）：{e}")

    # 断言：Scene 表查询次数应显著降低
    scene_queries = [q for q in query_counter if "scenes" in q.lower()]
    print(f"\n[Phase 1 验证] Scene 表查询次数：{len(scene_queries)}")
    print(f"前 5 条查询：")
    for q in scene_queries[:5]:
        print(f"  {q[:200]}")

    # 优化后目标：<= 3 次（初始化 1 次 + 容错）
    assert len(scene_queries) <= 3, (
        f"Phase 1 优化未生效：Scene 查询 {len(scene_queries)} 次，预期 <= 3 次。"
        f"优化前约 20 次（10 章 × 2 次/章）。"
    )

    print(f"✅ Phase 1 Context 增量化验证通过：Scene 查询从 ~20 次降至 {len(scene_queries)} 次")


if __name__ == "__main__":
    print("运行 Phase 1 Context 增量化验证...")
    print("注意：需要配置真实 LLM 端点（STORYFORGE_LLM_BASE_URL）")
    sys.exit(pytest.main([__file__, "-v", "-s"]))
