## 项目上下文摘要（Phase 9C-4 EPUB 与全书审计页）

生成时间：2026-05-27 16:36:17 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/exports/service.py`
  - 模式：使用标准库 `zipfile` 与 `BytesIO` 生成最小 EPUB，并通过 `create_artifact()` 登记导出制品。
  - 可复用：`build_epub_export()`、`ApprovedScene`、`_load_export_source()`、XHTML 转义逻辑。
  - 需注意：该路径以 `book_id` 为入口，9C-4a 需要以 `BookRun.id` 为入口并保留审计证据。
- **实现2**: `apps/api/app/domains/exports/book_markdown_exporter.py`
  - 模式：BookRun 导出先校验 `status == "completed"`，再收集已批准章节场景并写入 `artifacts`。
  - 可复用：`_completed_book_run()`、`_approved_scenes()`、`export_book_run_markdown()`、`export_book_run_audit_report()`。
  - 需注意：EPUB 不应新建平行章节查询，应复用 BookRun 导出前置条件和章节聚合。
- **实现3**: `apps/api/app/domains/book_runs/router.py`
  - 模式：BookRun 子资源以 `POST /api/book-runs/{id}/exports/*` 返回 `ArtifactRead`。
  - 可复用：既有 Markdown 与 audit-report 端点的异常映射和响应模型。
  - 需注意：新增 EPUB 端点应返回 artifact 元数据，而不是直接下载二进制。
- **实现4**: `apps/web/app/book-runs/api.tsx`
  - 模式：Web 侧将 API 类型、请求 helper 与可静态渲染组件放在同一模块，测试可直接导入组件。
  - 可复用：`BookRunRead`、`readBookRun()`、`BookRunStatusPanel`、导出 helper 风格。
  - 需注意：审计页应解析 `progress.completed_chapters` 和 `checkpoint`，不引入复杂图表。
- **实现5**: `apps/web/tests/book-runs.test.tsx`
  - 模式：使用 `node:test`、`node:assert/strict`、`renderToStaticMarkup()` 验证 React 组件输出。
  - 可复用：构造完整 `BookRunRead` 测试夹具，断言中文标题和证据 ID。
  - 需注意：新增审计页测试需要把新 runtime module 加入 `phase1-contract-test.mjs`。

### 2. 项目约定

- **Python 命名**：服务函数和 helper 使用 snake_case，异常类使用 PascalCase。
- **TypeScript 命名**：组件使用 PascalCase，helper 使用 camelCase，类型使用 PascalCase。
- **文件组织**：API BookRun 导出继续放在 `domains/exports/book_markdown_exporter.py`；BookRun 路由继续在 `domains/book_runs/router.py`；Web 审计组件放在 `app/book-runs/`。
- **代码风格**：中文 docstring、中文 UI 文案、无新增复杂依赖；优先复用标准库和既有测试入口。

### 3. 可复用组件清单

- `create_artifact()`: 统一写入 artifacts 并刷新版本。
- `build_epub_export()`: 现有 EPUB ZIP 结构参考。
- `_completed_book_run()`: BookRun 导出前置校验。
- `_approved_scenes()`: BookRun 已批准章节正文查询。
- `BookRunRead.progress.completed_chapters`: 审计页章节证据来源。
- `apps/web/scripts/phase1-contract-test.mjs`: Web TS/TSX 测试转译入口。
### 4. 测试策略

- **API 测试**：新增 `apps/api/tests/test_book_export_epub.py`，复用 `test_book_exporter.py` 的 BookRun seed 模式，并用 `ZipFile` 检查 `mimetype`、`META-INF/container.xml`、`OEBPS/content.opf`、章节 XHTML 与 artifact payload 摘要。
- **Web 测试**：新增 `apps/web/tests/book-run-audit.test.tsx`，用 `renderToStaticMarkup()` 验证审计页按章节展示 generate/judge/repair/approve/memory_extract 事件。
- **回归范围**：API 运行 `test_book_export_epub.py test_book_exporter.py`；Web 运行 `pnpm --filter @storyforge/web test -- book-run-audit book-runs`。

### 5. 依赖和集成点

- **外部依赖**：无新增依赖；EPUB 生成使用 Python 标准库 `zipfile`。
- **内部依赖**：BookRun 是整书运行真相源；Artifact 是导出制品索引；Web 从 BookRun progress 展示审计链。
- **集成方式**：新增 `POST /api/book-runs/{id}/exports/epub` 返回 `ArtifactRead`；Web 新增审计组件与动态页面。
- **配置来源**：不读取真实 LLM 密钥，不发起外部请求。

### 6. 技术选型理由

- **为什么用这个方案**：计划要求 9C-4 在 9A Markdown 稳定后引入 EPUB 与审计 UI；当前已有 book-level EPUB 和 BookRun audit_report，可组合复用。
- **优势**：本地可验证、改动集中、与既有 OpenAPI/Artifact 版本化一致。
- **劣势和风险**：标准库生成的是最小 EPUB，不等同于排版级出版物；审计页先展示证据链，不提供复杂筛选。

### 7. 关键风险点

- **边界条件**：BookRun 未完成、缺少 approved scene、缺少证据字段时必须拒绝导出。
- **性能瓶颈**：EPUB payload 仅保存摘要和 manifest，不把大二进制完整写入 JSON。
- **验证边界**：真实 3-5 万字短篇、人工通读和真实 LLM 冒烟仍需外部环境，不能在本地伪造完成。

### 8. 充分性检查

- 能定义接口契约：是，`POST /api/book-runs/{id}/exports/epub` 返回 `ArtifactRead`。
- 理解技术选型：是，复用标准库 ZIP 与现有 artifacts 写入。
- 识别主要风险：是，二进制 payload 膨胀、BookRun 证据缺失和范围膨胀。
- 知道如何验证：是，API ZIP 结构测试 + Web 静态渲染测试 + ruff/ts 回归。