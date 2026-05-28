# Artifact / Export Viewer P6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 StoryForge IDE 能在工作台内预览制品、查看下载摘要、比较版本，并从制品反向追溯 BookRun → ModelRun → Approve 链路。

**Architecture:** API 在 `/api/ide/artifacts/{artifact_id}/preview` 聚合 Artifact 详情、下载摘要、同 lineage 版本和 payload trace。Web 新增 `ArtifactViewer` 纯 SSR 组件，并将 BottomPanel 的 `artifacts` 分支接入该视图。

**Tech Stack:** FastAPI + SQLAlchemy；React SSR；pytest；node:test；OpenAPI 生成。

---

### Task 1: API Artifact Preview

**Files:**
- Modify: `apps/api/app/domains/ide/schemas.py`
- Modify: `apps/api/app/domains/ide/service.py`
- Modify: `apps/api/app/domains/ide/router.py`
- Test: `apps/api/tests/test_ide_artifact_preview.py`

- [ ] Write failing tests for preview success and missing artifact 404.
- [ ] Run RED: `cd apps/api; uv run pytest tests/test_ide_artifact_preview.py -q`.
- [ ] Implement preview schemas, service aggregation, and route.
- [ ] Run GREEN with the same command.

### Task 2: Web ArtifactViewer

**Files:**
- Create: `apps/web/components/ide/views/ArtifactViewer.tsx`
- Modify: `apps/web/components/ide/shell/BottomPanel.tsx`
- Modify: `apps/web/scripts/phase1-contract-test.mjs`
- Test: `apps/web/tests/ide-artifact-viewer.test.tsx`

- [ ] Write failing SSR tests for ArtifactViewer data state, empty state, and BottomPanel artifacts branch.
- [ ] Run RED: `pnpm --filter @storyforge/web test -- ide-artifact-viewer`.
- [ ] Implement component and shell wiring.
- [ ] Run GREEN with the same command.

### Task 3: Verification and Documentation

- [ ] Run `pnpm openapi`.
- [ ] Run `cd apps/api; uv run pytest tests/test_ide_artifact_preview.py tests/test_artifacts.py tests/test_book_exporter.py tests/test_book_export_epub.py -q`.
- [ ] Run `pnpm --filter @storyforge/web test`, `pnpm --filter @storyforge/web lint`, `pnpm --filter @storyforge/shared test`.
- [ ] Run `git diff --check`.
- [ ] Write `.codex/operations-log-p6-artifacts.md` and `.codex/verification-report-ide-p6.md`.

---

## Self-Review

- 覆盖 P6 API：`GET /ide/artifacts/{id}/preview`。
- 覆盖 P6 UI：ArtifactViewer 展示 md/epub 预览、下载摘要、版本对比、来源追溯。
- 覆盖退出标准：trace 中提供 BookRun、ModelRun、Approve 的可点击 href。
- 不伪造对象存储签名 URL 或完整 EPUB 阅读器，只展示当前后端可证明的数据。
