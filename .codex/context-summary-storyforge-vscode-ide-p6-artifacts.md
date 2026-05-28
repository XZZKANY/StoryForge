# 项目上下文摘要（storyforge-vscode-ide-p6-artifacts）

生成时间：2026-05-28 05:36:00

## 1. 相似实现分析

- **实现1**: `apps/api/app/domains/artifacts/{models,schemas,service,router}.py`
  - 模式：Artifact 以 `payload` 保存内容摘要和谱系元数据，已有详情与 `/download` 摘要端点。
  - 可复用：`get_artifact`、`read_artifact_download`、`ArtifactRead`、`ArtifactDownloadRead`。
  - 需注意：P6 要新增 IDE 聚合预览端点，不破坏现有 `/api/artifacts` 契约。
- **实现2**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：BookRun 导出生成 `book.md`、`audit_report.json`、`book.epub` 制品，payload 中保存 `book_run_id`、`blueprint_id`、章节 manifest 或 completed_chapters。
  - 可复用：导出制品 payload 可作为 Artifact Preview 的来源追溯数据。
  - 需注意：真实对象存储签名 URL 尚未实现，预览只能使用 payload/content_preview。
- **实现3**: `apps/web/app/artifacts/page.tsx`
  - 模式：旧页面读取制品列表、详情和下载摘要，展示空状态/错误/预览。
  - 可复用：字段命名、下载摘要文案、payload 预览思路。
  - 需注意：P6 要在 IDE 内提供 `ArtifactViewer`，替换 Bottom Panel artifacts 分支，而不是继续只展示旧页面占位。
- **实现4**: `apps/web/app/book-runs/audit.tsx`
  - 模式：从 BookRun progress.completed_chapters 展示 `model_run_id`、`judge_report_id`、`approved_scene_id` 链路。
  - 可复用：反向追溯标签和字段格式。
  - 需注意：P6 的退出标准是制品反向跳转到 BookRun → ModelRun → Approve 全链路。

## 2. 项目约定

- API 新增 IDE 聚合端点放在 `apps/api/app/domains/ide`，schema/service/router 分层。
- Web IDE 视图放在 `apps/web/components/ide/views`，BottomPanel 根据 activePanel 渲染对应视图。
- Web 测试使用 `node:test` + SSR `renderToStaticMarkup`；新增视图需登记到 `phase1-contract-test.mjs`。
- 自然语言使用简体中文，代码标识符保持英文。

## 3. 可复用组件清单

- `Artifact` / `ArtifactRead` / `ArtifactDownloadRead`
- `get_artifact` / `read_artifact_download`
- `BookRun` progress/checkpoint 字段
- `ArtifactViewer` 可复用 `DiffViewer` 思路但不直接依赖 diff 算法。

## 4. 测试策略

- API：新增 `apps/api/tests/test_ide_artifact_preview.py`。
  - 创建包含 `book_run_id`、`model_run_id`、`approved_scene_id` 的制品。
  - 验证 `GET /api/ide/artifacts/{id}/preview` 返回 markdown 预览、下载摘要、version 列表、trace 链路。
  - 验证缺失制品返回 404。
- Web：扩展/新增 `apps/web/tests/ide-artifact-viewer.test.tsx`。
  - 验证 `ArtifactViewer` 渲染 md/epub 预览、下载摘要、版本对比、BookRun → ModelRun → Approve 链路。
  - 验证 `BottomPanel activePanel='artifacts'` 渲染 ArtifactViewer。

## 5. 依赖和集成点

- 外部依赖：无新增。
- 内部依赖：IDE service 调用 artifacts service，按 artifact.lineage_key 查同谱系版本。
- 集成方式：BottomPanel artifacts 分支接 `ArtifactViewer` 空状态；有数据时由后续查询层注入。

## 6. 技术选型理由

- 预览 API 聚合现有 artifacts/download 数据，避免前端 N+1 查询和重复 payload 解析。
- trace 先从 artifact.payload 中提取 `book_run_id`、`model_run_id`、`approved_scene_id`、`judge_report_id`，与现有 BookRun 导出 payload 对齐。
- 版本对比先提供同 lineage 的版本摘要，不在 P6 引入重型 diff 依赖。

## 7. 关键风险点

- 对旧导出制品，payload 可能只有 `chapters`，没有顶层 `model_run_id`；需要从 chapters 中提取 trace。
- EPUB 当前 payload 无二进制内容，预览展示 manifest 和下载摘要，不伪装完整阅读器。
- 真实制品到 Approve 的 URL 仍是 IDE 内 trace href，实际详情页深跳可在后续阶段增强。
