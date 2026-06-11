## 项目上下文摘要（实施 dev plan）

生成时间：2026-05-27 17:53:11 +08:00

### 1. 相似实现分析

- `apps/api/app/domains/blueprints/`: 领域目录按 `models.py`、`schemas.py`、`service.py`、`router.py` 拆分，API 测试覆盖创建、读取、锁定和章节计划门禁。
- `apps/api/app/domains/book_runs/`: BookRun 复用 SQLAlchemy `Base`、`IdMixin`、`TimestampMixin`，以 `progress`、`checkpoint`、预算字段记录整书运行状态。
- `apps/api/app/domains/exports/book_markdown_exporter.py`: 统一以 completed BookRun 为导出前置条件，写入 `artifacts` 并保留 Markdown、audit_report、EPUB 摘要。
- `apps/workflow/storyforge_workflow/orchestrators/book_loop.py`: 纯函数编排 BookLoop，输入 `BookLoopRequest`，输出可回填 API 的 `BookLoopResult.progress`。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 组件测试通过转译真实 TS/TSX 生产模块，新增页面组件必须登记到 `runtimeModules` 与 `importRewrites`。

### 2. 项目约定

- Python 使用 `from __future__ import annotations`，测试描述、异常信息和文档字符串使用简体中文。
- API 领域按 router/service/schema/model 分层；路由只做 HTTP 映射，业务约束在 service 或纯函数中验证。
- Web 测试使用 `node:test` 与 `renderToStaticMarkup()`，测试脚本会把生产模块转译到临时目录。
- 工作流测试优先测纯函数，不依赖远程 LLM 或外部服务。

### 3. 可复用组件清单

- `seed_locked_blueprint()`：BookRun API 测试夹具，来自 `apps/api/tests/test_book_runs.py`。
- `BookLoopRequest`、`run_book_loop()`：9B resume、预算和 provider 降级门禁复用入口。
- `BookRunRead`、`BookRunStatusPanel`、`BookRunAuditPanel`：BookRun Web 状态和审计展示组件。
- `create_judge_issues()`：Character Bible、Timeline、Style Guard 的本地 Judge 规则验证入口。

### 4. 测试策略

- 计划命令中的显式文件名必须存在并可运行，不能只依赖聚合测试间接覆盖。
- 本轮先复现缺失文件导致的红灯：9B API、9B Workflow、9C Character/Timeline 门禁均报 `file or directory not found`。
- 修复后运行计划门禁文件：API 9B `3 passed`，Workflow 9B `2 passed`，API 9C 相关 `4 passed`。
- BookRun 审计页红灯来自测试转译脚本未包含 `app/book-runs/audit.tsx`，修复后 Web `book-run-audit book-runs` 为 `3 passed`。

### 5. 依赖和集成点

- BookRun 是整书运行真相源；Workflow 只输出进度和证据引用，API 负责持久化。
- Artifact 是导出制品索引；Markdown、audit_report、EPUB 都通过同一 BookRun 导出链路登记。
- Web 仅展示状态和审计证据，不直接编排长任务。

### 6. 当前完成度矩阵

- Phase 8：`.dev_plan.md` 已全部勾选；本轮未重新展开远端 CI 证据。
- Phase 9A：代码与测试已存在；`.codex/verification-report.md` 记录过 `pnpm verify`、`pnpm test`、`pnpm e2e` 通过，且 deterministic smoke 覆盖 3 章 BookRun、`book.md` 和 `audit_report.json`。
- Phase 9B：resume、预算字段、预算暂停、成本摘要和 provider 连续降级暂停已有本地实现与计划文件名测试；真实 LLM 1 章/3 章冒烟仍需私有模型配置，未执行。
- Phase 9C：Story Memory、Character Bible、Timeline、pacing、Style Guard、EPUB 和审计页已有本地测试；真实 3-5 万字短篇、EPUB 阅读器验收和人工通读仍未完成。

### 7. 充分性检查

- 能定义接口契约：是，BookRun API、导出端点和 Web 审计页均已定位。
- 理解技术选型：是，复用现有 API/Workflow/Web 分层，不新增微服务。
- 识别主要风险：是，远程真实 LLM 与人工通读无法在当前无密钥状态下伪造完成。
- 知道如何验证：是，使用计划显式 pytest 文件、Web 组件测试、ruff、Prettier 和后续全量门禁。
