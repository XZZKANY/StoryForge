# Performance Optimization A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 StoryForge 后端检索关键词去重、数据库连接池配置与 Retrieval Workbench source 列表 N+1 查询。

**Architecture:** 保持现有同步 FastAPI service + SQLAlchemy ORM 架构，不改变 API 契约，不引入新依赖。通过小范围纯函数、批量 SQL 查询和 pytest 回归测试降低性能风险。

**Tech Stack:** Python 3.11+、FastAPI、SQLAlchemy 2.0、pytest、PostgreSQL/SQLite 测试替身。

---

### Task 1: 数据库连接池配置

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/db/session.py`
- Test: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_db_session.py`

- [ ] **Step 1: Write the failing test**
  - 测试 `_build_engine_options` 默认返回连接池配置。
  - 测试环境变量覆盖配置。
  - 测试 sqlite URL 不传递 QueuePool 参数。

- [ ] **Step 2: Run test to verify it fails**
  - Run: `python -m pytest tests/test_db_session.py -q`
  - Expected: FAIL，因为 `_build_engine_options` 尚不存在。

- [ ] **Step 3: Implement minimal code**
  - 新增 `_get_int_env` 与 `_build_engine_options`。
  - `engine = create_engine(DATABASE_URL, **_build_engine_options(DATABASE_URL))`。

### Task 2: 关键词去重优化

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
- Test: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_embedding.py`

- [ ] **Step 1: Write the failing test**
  - 断言 `_keywords("灯塔灯塔 灯塔灯塔")` 保留首次出现顺序且没有重复项。

- [ ] **Step 2: Run test to verify it fails**
  - Run: `python -m pytest tests/test_retrieval_embedding.py::test_keywords_preserve_order_without_duplicate_candidates -q`
  - Expected: 当前行为可能语义通过但性能目标无法由结果断言捕获；若通过，则补充源码级断言或直接记录此测试为行为保护。

- [ ] **Step 3: Implement minimal code**
  - 将 `seen: list[str]` 改为 `seen: set[str]`，另用 `keywords: list[str]` 保序返回。

### Task 3: Workbench source 列表消除 N+1

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/app/domains/retrieval/service.py`
- Test: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_retrieval_workbench_api.py`

- [ ] **Step 1: Write the failing test**
  - 构造 3 个 source 与多个 refresh run。
  - 调用 `list_retrieval_workbench_sources` 并通过 SQLAlchemy 事件计数 SELECT 数量。
  - 断言最新 run 状态正确且 SELECT 数量不超过 3。

- [ ] **Step 2: Run test to verify it fails**
  - Run: `python -m pytest tests/test_retrieval_workbench_api.py::test_list_retrieval_workbench_sources_batches_latest_refresh_runs -q`
  - Expected: FAIL，当前每个 source 会单独查询 latest refresh run。

- [ ] **Step 3: Implement minimal code**
  - 新增 `_load_latest_refresh_runs_by_source_id`，使用 `group_by(source_id)` 与 `max(id)` 子查询批量取最新 run。
  - `_build_workbench_source` 接受可选 `latest_refresh`，列表入口批量传入。

### Task 4: 本地验证与报告

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/operations-log.md`
- Create: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/verification-report.md`

- [ ] **Step 1: Run targeted tests**
  - `python -m pytest tests/test_db_session.py tests/test_retrieval_embedding.py tests/test_retrieval_workbench_api.py -q`

- [ ] **Step 2: Run related API tests**
  - `python -m pytest tests/test_retrieval_index.py tests/test_retrieval_embedding.py tests/test_retrieval_workbench_api.py tests/test_db_session.py -q`

- [ ] **Step 3: Write verification report**
  - 记录命令、退出码、失败/通过数量、评分与建议。
