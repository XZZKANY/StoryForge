## 项目上下文摘要（StoryForge 总重规划）

生成时间：2026-05-17 22:20:00 +08:00

### 1. 仓库与 GitHub 状态

- 实际 Git 仓库：`D:/StoryForge/1-renovel-ai-ai-rag-tavern`。
- 远程地址：`origin https://github.com/XZZKANY/StoryForge.git`。
- 当前分支：`master`，跟踪 `origin/master`。
- 本地与远程最新提交一致：`95f3642 feat: complete phase4 engineering and verification`。
- 远程分支核验：`refs/heads/master` 指向 `95f364221ce8ae541d05a42a3b5bc2a6a7f709eb`。
- 当前未跟踪文件：`docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`。

### 2. 相似实现与计划模式分析

- **Phase 1 计划**：`docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md`
  - 模式：目标、架构、技术栈、范围门禁、任务依赖图、逐任务 Files/Step/验证命令。
  - 可复用：阶段计划必须把 API、workflow、web、shared、e2e 验证串成闭环。
  - 注意：旧阶段已完成，不能作为待实现主线重复执行。
- **Phase 2 计划**：`docs/superpowers/plans/2026-05-15-storyforge-phase2-engineering-plan.md`
  - 模式：延续模块化单体，按领域目录拆分 series/worldbuilding/batch_refinery/style_packs/quality。
  - 可复用：每个能力都绑定测试文件、领域服务、router 和前端入口。
  - 注意：计划标题存在英文片段，但后续新增内容必须使用简体中文。
- **Phase 4 计划**：`docs/superpowers/plans/2026-05-17-storyforge-phase4-engineering-plan.md`
  - 模式：在 Phase 1~3 基础上交付检索、Prompt Pack、模型运行日志、持久化 runtime、制品、评测。
  - 可复用：后续 Phase 5 应继续沿用“先测试、再服务、再契约、再验证报告”的门禁。
  - 注意：末尾旧的 Phase 5 候选偏向多模态/插件，本次总重规划应调整为真实 AI/RAG 与产品可用化优先。
- **总重规划草案**：`docs/superpowers/plans/2026-05-17-storyforge-master-replan.md`
  - 模式：已有当前状态结论、CC 中断原因、新路线和后续执行提示。
  - 可复用：保留 Phase 0/5/6/7 方向。
  - 需补强：缺少任务依赖图、文件责任、逐阶段验收命令、风险关闭条件和 GitHub 纳入版本控制步骤。

### 3. 项目约定

- 命名约定：Python 模块使用 `snake_case` 领域目录；TypeScript 页面使用 Next.js App Router 的 `app/<route>/page.tsx`；测试文件使用 `test_*.py`、`*.spec.ts`、`*.test.tsx`。
- 文件组织：`apps/api` 负责业务真相源与 HTTP API；`apps/workflow` 负责 LangGraph 长任务；`apps/web` 负责页面入口；`packages/shared` 保存共享契约；`tests/e2e` 保存阶段契约。
- 导入顺序：`apps/api/app/main.py` 先导入各领域 `router`，再统一 `app.include_router(...)`；`apps/api/app/models.py` 集中导入 ORM 模型并维护 `__all__`。
- 文档风格：简体中文、短段落、明确标题、任务清单、PowerShell/项目脚本命令块。

### 4. 可复用组件清单

- `scripts/run-e2e.mjs`：根级 e2e 与补偿验证入口，会刷新 OpenAPI、运行 Phase 1~4 契约、探测 FastAPI TestClient，并回退到服务层验收。
- `scripts/verify-local.ps1`：环境与基础路径验证入口，检查 Node、pnpm、Python、Docker、关键目录和容器状态。
- `apps/api/app/main.py`：FastAPI router 注册清单，是确认 API 能力范围的入口。
- `apps/api/app/models.py`：ORM 模型集中导入清单，是确认领域模型覆盖的入口。
- `packages/shared/src/contracts/storyforge.openapi.json`：前后端共享 OpenAPI 契约快照。
- `.codex/verification-report.md`：Phase 1~4 验证事实和环境限制事实源。

### 5. 测试策略

- 根级脚本：`pnpm e2e`，实际调用 `node scripts/run-e2e.mjs`。
- Web：`pnpm --filter @storyforge/web test`、`pnpm --filter @storyforge/web exec tsc --noEmit`。
- Shared：`pnpm --filter @storyforge/shared test`。
- API：当前稳定基线为 `python -m compileall apps/api/app apps/api/tests` 加服务层补偿 pytest；正常环境下补跑 HTTP route pytest。
- Workflow：`python -m compileall apps/workflow/storyforge_workflow apps/workflow/tests` 与 `pytest tests/test_generation_graph.py tests/test_runtime_runner.py -q`。
- 文档计划验证：检查计划文件存在、章节存在、GitHub 同步命令存在、Phase 0/5/6/7 均有验收标准。

### 6. Context7 官方文档要点

- Next.js `/vercel/next.js`：App Router 使用 `app/` 目录，页面可导出 `metadata`，路由产物区分 `APP_PAGE` 与 `APP_ROUTE`；后续前端计划应继续使用 `app/<route>/page.tsx`。
- FastAPI `/fastapi/fastapi`：大型应用使用 `APIRouter` 组织 path operation，测试使用 `fastapi.testclient.TestClient` 和 pytest；当前仓库已有环境阻塞探针与补偿验证。
- SQLAlchemy 2.0 ORM `/websites/sqlalchemy_en_20_orm`：声明式映射使用 `Mapped` 与 `mapped_column`；仓库现有模型集中导入和迁移策略应继续保留。

### 7. 依赖与集成点

- GitHub 集成：先 `git fetch origin --prune`，确认 `master...origin/master` 无 ahead/behind，再开始执行。
- API 集成：新增领域能力必须注册 `router`，并在 `models.py` 导入 ORM 模型。
- Web 集成：新增页面必须进入 `apps/web/app/<route>/page.tsx`，必要时更新首页导航和源码契约测试。
- Workflow 集成：长任务继续通过 runtime、checkpoint、JobRun、model_runs 记录状态，不让前端直接持有工作流状态。
- 配置环境：Docker Compose 提供 PostgreSQL/pgvector、Redis、MinIO；`.env.example` 是 Phase 7 治理重点。

### 8. 技术选型理由

- 继续模块化单体：Phase 1~4 已按该边界完成，拆微服务会增加验证面和交付风险。
- 继续本地优先验证：AGENTS 明确禁止依赖 CI 或人工外包验证，现有 `run-e2e.mjs` 已把环境限制转化为可记录补偿链。
- Phase 5 优先真实 AI/RAG：Phase 4 已完成工程闭环，最大价值缺口是 provider、embedding、reranker 和证据链真实化。
- Phase 6 优先工作台可用化：现有前端更偏契约展示，需要把能力入口串成连续操作流。
- Phase 7 优先发布治理：新机器启动、Docker、迁移、OpenAPI、verify 脚本是交接风险最高的部分。

### 9. 关键风险点

- GitHub 与本地不同步：执行者可能基于旧计划重复实现；必须先 fetch/status/log。
- 未跟踪总计划：当前 master replan 尚未纳入 Git，后续需提交或明确保留为草案。
- FastAPI HTTP pytest 环境限制：当前沙箱曾阻塞，应保留探针与服务层补偿验收。
- 真实 provider 接入风险：token、延迟、失败重试、成本与降级路径必须通过离线模拟测试覆盖。
- 检索侵入真相源风险：向量结果只能保存引用和证据，不替代结构化业务表。
- 前端可用化风险：不能只堆页面，必须按 Studio、Retrieval、Runs、Artifacts、Evaluations 的真实操作链验收。

### 10. 充分性检查

- 能定义接口契约：是，后续阶段均绑定 API router、workflow runtime、web page、OpenAPI/e2e 契约。
- 理解技术选型：是，继续使用 Next.js App Router、FastAPI APIRouter、SQLAlchemy 2.0、LangGraph/runtime、pnpm/uv。
- 识别主要风险：是，已列出同步、环境、真实依赖、检索边界、前端交互和发布治理风险。
- 知道如何验证：是，使用 `pnpm e2e`、Web test/tsc、API compileall/pytest、workflow compileall/pytest、文档章节检查。
