# Phase 7 Release Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补强 StoryForge Phase 7 发布治理可信度，证明干净数据库迁移、审计事实入口和发布门禁均可复现。

**Architecture:** 本计划不新增产品功能，只更新发布治理文档、`.codex` 审计留痕和本地验证记录。干净数据库验证使用临时 PostgreSQL 数据库，不清理主库或主数据卷。

**Tech Stack:** PowerShell、Docker Compose、PostgreSQL/pgvector、Alembic、pnpm、Node.js、Python 3.12。

---

### Task 1: 干净数据库 Alembic 验证

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/operations/alembic-validation.md`
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/verification-report.md`

- [ ] 创建临时库 `storyforge_phase7_clean_verify`。
- [ ] 使用 `DATABASE_URL=postgresql+psycopg://storyforge:storyforge@127.0.0.1:55432/storyforge_phase7_clean_verify` 执行 `uv run alembic upgrade head`。
- [ ] 执行 `uv run alembic current --check-heads`，期望输出 `20260520_0001 (head)`。
- [ ] 清理临时库，避免影响主库。

### Task 2: 审计事实入口压缩

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`

- [ ] 保留 `.codex/current-phase.md` 作为当前 Phase 主入口。
- [ ] 在 TODO 中写明后续代理优先阅读顺序：`current-phase`、`TODO`、`verification-report`、按需检索 `operations-log`。
- [ ] 不删除历史 `.codex/operations-log.md` 内容。

### Task 3: 发布门禁复跑与推送

**Files:**
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/verification-report.md`
- Modify: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`

- [ ] 运行 `pnpm verify`。
- [ ] 运行 `pnpm openapi`，如有 diff 必须解释来源。
- [ ] 运行 `pnpm test` 与 `pnpm e2e`。
- [ ] 运行 `git diff --check`。
- [ ] 提交并推送 `origin master`。
