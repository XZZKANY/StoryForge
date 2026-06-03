## 项目上下文摘要（Assistant 导出审计 P0）

生成时间：2026-06-03 05:25:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-intent.ts`
  - 模式：确定性解析自然语言任务，包含“导出”“审计报告”“EPUB”“Markdown”时进入 `artifact_export`。
  - 可复用：`requestedArtifactsFor('artifact_export')` 返回 `markdown`、`epub`、`audit`。
  - 需注意：意图解析只能确定任务类型，不代表已具备真实 completed BookRun。
- **实现2**: `apps/web/components/home/assistant-artifact-export-actions.ts`
  - 模式：Server Action 读取 `book_run_id`，仅 completed BookRun 允许导出；依次调用 Markdown、EPUB、audit_report 导出 API；成功后写 AssistantSession 并 redirect 回首页消息流。
  - 可复用：`submitAssistantArtifactExport()`、`exportRequests`、`readArtifactSummary()`、`formatArtifactExportSummary()`。
  - 需注意：导出成功摘要需要携带 artifact 摘要、版本、关联 BookRun 和下载摘要提示。
- **实现3**: `apps/web/components/home/AssistantActionBar.tsx`
  - 模式：流程操作条根据真实 `bookRunStatus` 控制按钮状态。
  - 可复用：`bookRunStatus === 'completed'` 时启用导出，非 completed 时用 `title` 说明不可导出原因。
  - 需注意：按钮启用状态来自 `AssistantConversation` 读取的真实 BookRun，不得伪造 completed。
- **实现4**: `apps/web/components/home/assistant-tool-node-mapper.ts`
  - 模式：从 BookRun progress 中查找 `audit_report`、`exported_artifacts`、`artifact_exports` 等事实源，映射 `Artifact.export` 节点状态。
  - 可复用：`findAuditExportEvidence()` 和导出摘要文案。
  - 需注意：无导出证据的 completed BookRun 仍应为 waiting。
- **实现5**: `apps/api/tests/test_book_exporter.py`
  - 模式：后端本地测试直接覆盖 completed BookRun 导出 `book.md`、`book.epub`、`audit_report.json`，并验证审计报告 skill chain 不复制完整提示词或正文。
  - 可复用：API 端导出证据和 `test_book_run_export_endpoints_return_artifacts`。
  - 需注意：该测试不运行真实外部 LLM。

### 2. 项目约定

- **命名约定**: 前端任务类型使用 `artifact_export`；工具名使用 `Artifact.export`；API 路径使用 `/api/book-runs/{id}/exports/*`。
- **文件组织**: 前端 Assistant action 放在 `components/home/*-actions.ts`；BookRun API helper 放在 `app/book-runs/api.tsx`；后端导出实现放在 `apps/api/app/domains/exports/`。
- **导入顺序**: Server Action 先导入 Next server helper，再导入 app API/helper 和本地 session-store。
- **代码风格**: Web 测试使用 `node:test` 与 `assert`；API 测试使用 pytest；用户可读文案使用简体中文。

### 3. 可复用组件清单

- `exportMarkdownRequest()`、`exportEpubRequest()`、`exportAuditReportRequest()`: 统一构造导出 API 请求。
- `readBookRun()`: 读取真实 BookRun 状态，供导出前置门禁使用。
- `appendAssistantSessionMessage()`、`createAssistantSession()`: 导出成功后写入可追溯 Assistant 会话。
- `ArtifactsPageContent`: 读取 `/api/artifacts`、详情和下载摘要，用于展示导出制品。
- `export_book_run_markdown()`、`export_book_run_epub()`、`export_book_run_audit_report()`: 后端导出事实源。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`；API 使用 pytest。
- **测试模式**: 意图解析测试覆盖 `artifact_export`；action 测试覆盖 completed 导出、非 completed 拒绝、失败回流、会话写入；工具树测试覆盖导出 waiting/completed；API 测试覆盖三类导出 endpoint。
- **参考文件**: `apps/web/tests/assistant-intent.test.ts`、`apps/web/tests/assistant-artifact-export-actions.test.ts`、`apps/web/tests/assistant-tool-node-mapper.test.ts`、`apps/web/tests/book-runs.test.tsx`、`apps/api/tests/test_book_exporter.py`。
- **覆盖要求**: completed BookRun 导出三类制品；非 completed 不导出；成功消息携带制品摘要、版本、关联 BookRun 和下载摘要提示；Artifacts 页面可读制品列表、详情和下载摘要。

### 5. 依赖和集成点

- **外部依赖**: Next.js Server Actions、FastAPI、SQLAlchemy。
- **内部依赖**: BookRun API、Artifacts API、AssistantSession helper、Home query 参数回流。
- **集成方式**: 导出 action redirect 回首页，`AssistantConversation` 根据 `artifact_export_status` 和 `artifact_export_summary` 生成消息。
- **配置来源**: 不读取 `.env`；API 访问通过现有 `api-client` 边界。

### 6. 技术选型理由

- **为什么用这个方案**: P0 目标是完成 Assistant 内导出审计链路，已有后端导出 API 和前端 action，最小补强应扩展摘要字段而不是重写导出 API。
- **优势**: 保持导出链路本地可验证；不增加真实外部 LLM 或 provider 依赖；消息流能给用户更完整的追溯摘要。
- **劣势和风险**: 本轮不额外调用 `/api/artifacts/{id}/download`，下载摘要是“可在 Artifacts 查看下载摘要”的提示，不是下载端点真实返回内容。

### 7. 关键风险点

- **并发问题**: 重复点击导出可能创建多个 artifact 版本；后端 `create_artifact` 会递增版本。
- **边界条件**: 缺 `book_run_id`、非 completed、导出 API 失败时不得写 AssistantSession。
- **性能瓶颈**: 三类导出顺序执行；本轮不新增额外下载摘要请求，避免导出 action 变重。
- **安全考虑**: 审计报告测试确认不复制完整提示词或正文；本阶段不读取 `.env`，不输出凭据。
