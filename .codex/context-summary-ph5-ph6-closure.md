# 项目上下文摘要（Phase 5/6 收口）

生成时间：2026-05-20 17:16:00 +08:00

## 1. 相似实现分析

- **实现1**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`
  - 模式：当前 Phase 事实入口，用表格区分已实现、已有契约但未联通、完全不存在。
  - 可复用：第 2 节风险状态、第 3 节状态区分、第 4 节验证入口。
  - 需注意：不能把未联通的 adapter/client、批准回写或失败恢复误标为已实现。
- **实现2**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/architecture/phase6-workbench-contract.md`
  - 模式：契约文档定义页面入口、真实数据联动边界和验收命令。
  - 可复用：最小 API 数据源契约、状态矩阵、验收命令。
  - 需注意：Phase 6 收口是当前边界收口，不是一次性打通五页完整工作台。
- **实现3**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/lib/phase6-data-sources.ts`
  - 模式：typed registry 统一承载五个页面的数据源状态、契约章节和下一步动作。
  - 可复用：`phase6DataSources`、`Phase6DataSourceStatus`、`phase6FirstDataSourceSpike`。
  - 需注意：后续 spike 必须从 registry 中选择单页面单数据源，禁止重新分散手写入口。
- **实现4**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/app/studio/page.tsx`
  - 模式：Next.js App Router 页面级 `fetch(..., { cache: "no-store" })` 单点读取，并提供 ready/error/idle 状态。
  - 可复用：错误摘要、空态、类型守卫和链式读取顺序。
  - 需注意：当前收口不新增页面读取，只审计已有事实。
- **实现5**: `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/api/tests/test_studio_book_list_api.py`
  - 模式：FastAPI `TestClient` + SQLite 内存库 + SQLAlchemy fixture 的最小契约测试。
  - 可复用：成功态、过滤、空态、404 缺失态和中文测试描述。
  - 需注意：本轮如果只改文档，不需要新增 API 测试。

## 2. 项目约定

- **命名约定**：Python 使用 `snake_case`，TypeScript 类型与组件使用 `PascalCase`，常量和函数使用既有英文标识符。
- **文件组织**：API 事实源在 `apps/api/app/domains/*`，Web 页面在 `apps/web/app/*`，共享前端契约在 `apps/web/lib/*`，审计材料在 `.codex/`。
- **导入顺序**：保留项目已有相对导入和标准库、第三方库、项目库分层。
- **代码风格**：文档、注释、测试描述和报告全部使用简体中文；Markdown 使用短节、列表和表格。
## 3. 可复用组件清单

- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/package.json`：根级 `pnpm test`、`pnpm e2e`、`pnpm openapi`、`pnpm verify`。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`：当前 Phase 事实入口。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/TODO.md`：阶段任务池和最近迭代记录。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/architecture/phase6-workbench-contract.md`：Phase 6 工作台边界。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/architecture/workflow-modelrun-adapter-contract.md`：Phase 5 ModelRun adapter 边界。
- `D:/StoryForge/1-renovel-ai-ai-rag-tavern/apps/web/lib/phase6-data-sources.ts`：页面数据源状态 registry。

## 4. 测试策略

- **测试框架**：Web 使用 Node test/TypeScript 检查；API 使用 pytest 或根级 compileall；Workflow 使用 pytest 或 compileall。
- **参考文件**：`apps/web/tests/phase1-navigation.test.tsx`、`apps/api/tests/test_studio_book_list_api.py`、`apps/api/tests/test_retrieval_workbench_api.py`、`apps/api/tests/test_model_runs.py`。
- **本轮验证**：文档收口优先跑文档存在性、关键字一致性、`git status`、`pnpm test`；如 Docker 或服务不可用，记录补偿计划。
## 5. 依赖和集成点

- **外部依赖**：Next.js App Router 页面级数据读取；FastAPI APIRouter/OpenAPI；SQLAlchemy/Alembic；pnpm 与 Python 本地运行时。
- **内部依赖**：Phase 5 依赖 story_memory、compiled_contexts、workflow state、retrieval/reranker、ModelRun sink/payload；Phase 6 依赖 Studio/Retrieval/Runs API 与 Web 页面契约。
- **配置来源**：`.env.example`、`STORYFORGE_API_BASE_URL`、provider/embedding/reranker 环境变量、Docker Compose 服务。
- **集成方式**：当前收口只统一事实入口和验证留痕，不新增运行时依赖或跨服务 client。

## 6. 技术选型理由

- **为什么只做审计收口**：`README.md`、`TODO.md` 和 `.codex/current-phase.md` 已明确当前进入 Phase 7，且要求不继续扩 Studio/Retrieval/Runs/Artifacts/Evaluations 数据源。
- **优势**：降低后续代理误判范围的风险，保留可验证事实，不把未实现功能伪装成完成。
- **劣势和风险**：仍存在后续功能待办；需要通过报告明确它们已移出本轮 Phase 5/6 收口范围。
## 7. 关键风险点

- **边界风险**：Workflow-to-API ModelRun 真表 adapter/client、Studio 批准回写/失败恢复、Retrieval 独立证据跳转、Runs 页面读取、Artifacts/Evaluations 真实数据读取仍是后续待办。
- **验证风险**：Docker/PostgreSQL、FastAPI TestClient 或 ASGI HTTP pytest 可能受本机环境影响；需要优先记录实际命令输出。
- **文档漂移风险**：README、TODO、PROJECT_SUMMARY、current-phase 和 Phase 6 契约文档若表述不一致，会导致后续继续扩范围。
- **性能风险**：本轮不新增运行时代码，无新增性能消耗；后续真实数据联动必须继续按单页面单数据源推进。

## 8. 充分性检查

- 能定义接口契约：是，本轮交付为审计文档和验证报告，输入为现有事实源，输出为 `.codex` 收口记录和一致性校准。
- 理解技术选型理由：是，复用现有模块化单体、App Router、FastAPI 和本地验证脚本。
- 识别主要风险点：是，未实现功能不得被标记为已实现。
- 知道如何验证实现：是，使用 `Test-Path`、关键字检查、`git status`、`pnpm test` 和必要的 `git diff --check`。
