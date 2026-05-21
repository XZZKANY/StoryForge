# 操作日志

## 任务启动

时间：2026-05-21 17:33:06 +08:00

- 使用 sequential-thinking 梳理 6 类遗留问题、风险和执行顺序。
- 使用 shrimp-task-manager 建立 4 个任务：上下文扫描、回归测试、实施修复、本地验证与报告。
- 使用 desktop-commander 完成本地文件检索和读取。
- 使用 Context7 查询 LangGraph persistence/checkpointer 文档。
- GitHub `search_code` 工具本会话未暴露，已使用项目内代码检索与 Context7 官方文档替代。

## 编码前检查 - legacy-fixes

时间：2026-05-21 17:33:06 +08:00

- 已查阅上下文摘要文件：`.codex/context-summary-legacy-fixes.md`
- 将使用以下可复用组件：
  - `apps/web/lib/api-client.ts`: 用于 Studio API URL 与 API Key 注入。
  - `apps/api/tests/conftest.py`: 用于 API 本地 TestClient 与内存 SQLite。
  - `apps/workflow/storyforge_workflow/state.py`: 用于 checkpoint 引用化。
  - `apps/workflow/tests/test_generation_graph.py`: 用于 LangGraph 中断/恢复测试模式。
- 将遵循命名约定：TypeScript 类型 PascalCase、函数 camelCase；Python 函数 snake_case、类 PascalCase。
- 将遵循代码风格：中文文案与注释、pytest 测试、Next Server Component 分层。
- 确认不重复造轮子：已检查 Studio 模块、API client、Judge service、workflow state/runtime、FastAPI router 注册。
## 回归测试红灯记录

时间：2026-05-21 17:33:06 +08:00

- 首次局部测试从 `D:/StoryForge` 启动，未进入实际项目根，命令因找不到 `package.json` 或测试目录失败；该结果不作为功能红灯。
- 使用正确工作目录重跑后，前端测试暴露 `app/studio/page-content.tsx` 缺失；API 测试暴露 `semantic_judge` 不支持 provider 注入且下线 router 仍注册；workflow 测试因新内存替身 import 写法导致收集阶段失败，已修正为运行期断言。
## 回归测试红灯确认

时间：2026-05-21 17:33:06 +08:00

- `pnpm --filter @storyforge/web test`：失败，命中 `page-content.tsx` 缺失与 `TODO.md` 连续问号编码损坏。
- `uv run pytest tests/test_judge_semantic.py tests/test_api_surface.py`：失败，命中 `semantic_judge()` 不支持 provider 注入与 `/api/analytics` 仍注册。
- `uv run pytest tests/test_generation_state_references.py tests/test_generation_graph.py`：失败，命中缺少 `InMemoryRuntimeCheckpointStore`、默认 RuntimeCheckpointStore 不支持 SQLite 路径，以及 `create_generation_graph` 未拒绝隐式内存 checkpointer。
## 编码后声明 - legacy-fixes

时间：2026-05-21 18:06:31 +08:00

### 1. 复用了以下既有组件

- `apps/web/lib/api-client.ts` 的 API URL 模式被 Studio API 拆分参考，保留 `cache: "no-store"` 与中文错误文案。
- `apps/api/tests/conftest.py` 的 TestClient 和本地 SQLite 夹具继续用于 Judge 和 router 注册面验证。
- `apps/workflow/storyforge_workflow/state.py` 的 `checkpoint_reference_state` 用于 SQLite checkpoint 写入前引用化。
- `apps/workflow/tests/test_generation_graph.py` 的显式 `InMemorySaver` 测试替身模式用于图中断/恢复测试。

### 2. 遵循了以下项目约定

- 命名约定：TypeScript 类型继续使用 `Studio*` PascalCase，读取函数使用 `readStudio*` camelCase；Python 使用 snake_case 函数和 PascalCase 数据类。
- 代码风格：文档、注释、测试名称和错误文案均使用简体中文；Python 保持 `from __future__ import annotations` 开头。
- 文件组织：Studio 按 `types.ts`、`validators.ts`、`api.ts`、`actions.tsx`、`page-content.tsx` 分层；API 保持 domain router/service 分层；workflow runtime 持久化放在 `runtime/checkpoints.py`。

### 3. 对比了以下相似实现

- `apps/web/app/retrieval/page.tsx`：沿用 Server Component 数据读取和中文 fallback 文案，但 Studio 页面进一步拆出 API 与页面内容。
- `apps/api/app/domains/studio/router.py`：保持真实链路 router 注册，精简 main.py 中下线域注册。
- `apps/workflow/tests/test_runtime_runner.py`：运行器测试改为显式内存替身，SQLite 默认持久化由独立测试覆盖。

### 4. 未重复造轮子的证明

- 已检查 Studio 空壳模块、API client、Judge service、workflow state/runtime 与 FastAPI router 注册；未发现可直接复用的 SQLite runtime store，因此用标准库 `sqlite3` 实现最窄持久化边界。

## 编码前检查 - 上线前硬化

时间：2026-05-21 00:00:00 +08:00

□ 已查阅上下文摘要文件：`.codex/context-summary-hardening.md`
□ 将使用以下可复用组件：

- `apps/web/lib/api-client.ts`: 统一 API URL、API Key、no-store 与返回体校验。
- `apps/web/app/studio/validators.ts`: Studio 后端返回体校验。
- `apps/web/tests/phase1-navigation.test.tsx`: Web 静态契约回归测试。

□ 将遵循命名约定：TypeScript camelCase 函数/常量、PascalCase 类型、中文测试描述。
□ 将遵循代码风格：Next.js App Router async Server Component、`import type`、只读类型、中文用户可见文案。
□ 确认不重复造轮子：已检查 `api-client.ts`、Retrieval/Runs 手写 API Key 模式、Studio validators/types，新增 `apiFetch` 是对既有 client 的抽取，不新增平行 client。

### 工具与检索说明

- 已按顺序执行 sequential-thinking 与 shrimp-task-manager。
- 已使用 Context7 查询 Next.js App Router `fetch` 与 `cache: "no-store"` 用法。
- 当前没有可调用的 `github.search_code` 工具，已在上下文摘要中记录替代依据。

## 红灯测试记录 - 上线前硬化

时间：2026-05-21 00:00:00 +08:00

命令：`powershell.exe -NoProfile -Command "pnpm.cmd --filter @storyforge/web test"`

结果：失败，符合 TDD 红灯预期。

关键失败：

- `api-client 应暴露统一 apiFetch`：当前尚未实现统一底层 API client。
- `app/page.tsx 不应把未联通能力描述为“实验室”`：当前首页仍包含过度承诺文案。

补充：直接运行 `pnpm --filter @storyforge/web test` 受 PowerShell profile / ps1 执行策略阻塞，后续验证统一使用 `powershell.exe -NoProfile -Command "pnpm.cmd ..."`。

## 编码中监控 - 统一 Web API 访问层

时间：2026-05-21 00:00:00 +08:00

□ 是否使用了摘要中列出的可复用组件？
✅ 是：`api-client.ts` 新增 `apiFetch()` 并让 `readJson()` 复用；Studio/Artifacts/Evaluations 读取迁移到 `readJson()`；Studio POST 迁移到 `apiFetch()`。

□ 命名是否符合项目约定？
✅ 是：沿用 `readJson`、`buildApiUrl`、`studioApproveEndpoint` 等 camelCase 命名。

□ 代码风格是否一致？
✅ 是：保持 Server Component/Server Action 读取返回 `ready/error/idle` 状态和中文错误摘要。

验证片段：`pnpm.cmd --filter @storyforge/web test` 中 API client 相关测试已通过，当前仅剩产品文案红灯。

## 编码后声明 - 产品叙事与页面信息架构

时间：2026-05-21 00:00:00 +08:00

### 1. 复用了以下既有组件

- `phase6-workbench-contract.md`: 用于确认五页当前对象、证据、动作与剩余边界。
- `phase1-navigation.test.tsx`: 用于把过度承诺文案转成可回归检查。

### 2. 遵循了以下项目约定

- 命名约定：保留 App Router 页面导出与 camelCase 数组命名。
- 代码风格：页面仍为服务端组件，用户可见文案全部使用简体中文。
- 文件组织：首页、页面、README、PROJECT_SUMMARY 分别承载对应抽象层，不复制底层契约矩阵。

### 3. 对比了以下相似实现

- `studio/page-content.tsx`: 继续保留真实读取链路，但把顶部信息改为当前对象/证据/动作/边界。
- `retrieval/page.tsx` 与 `runs/page.tsx`: 保留 query 驱动读取，文案改为证据链路和运行链路。
- `artifacts/page.tsx` 与 `evaluations/page.tsx`: 保留真实读取，降级为治理与诊断入口。

### 4. 未重复造轮子的证明

- 检查了 `phase6-data-sources.ts` 与契约文档，registry 保留为工程事实源；用户页面不再重复渲染完整矩阵。

验证：`powershell.exe -NoProfile -Command "pnpm.cmd --filter @storyforge/web test"` 通过 7/7。

## 验证记录 - 上线前硬化

时间：2026-05-21 00:00:00 +08:00

- Web 测试：`pnpm.cmd --filter @storyforge/web test`，7/7 通过。
- Web lint：`pnpm.cmd --filter @storyforge/web lint`，`tsc --noEmit` 通过。
- 根测试：`pnpm.cmd run test` 中 Web/shared/API 通过；Workflow 因 Windows Temp 权限拒绝失败。
- Workflow 补偿：`cd apps/workflow; uv run pytest --basetemp .pytest-tmp`，13/13 通过。
- OpenAPI：`pnpm.cmd openapi` 成功生成契约文件，但工作树存在 OpenAPI diff，需单独审阅。
- 页面级验证：本地 API + Web 启动后，`/studio`、`/retrieval`、`/runs?job_run_id=1`、`/artifacts`、`/evaluations` 均返回 200，非空，无 401、格式错误和明显 hydration/server component 错误。
- API 直读补充：`/api/artifacts` 与 `/api/evaluations/runs` 带 API Key 返回 500，API 日志指向 `WorkspaceSubscription` SQLAlchemy 映射问题；已写入验证报告作为发布前风险。


## 运行全流程 - 操作记录

时间：2026-05-21 20:09:00

### 需求与约束

- 用户要求使用提供的 OpenAI 兼容 API 地址和密钥跑一遍全流程。
- API 地址：`https://dc.hhhl.cc/v1`。
- API Key：已接收但全程隐藏，不写入文件或报告。
- 采用进程级环境变量：`STORYFORGE_LLM_BASE_URL`、`STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_MODEL`。

### 编码前检查

□ 已查阅上下文摘要文件：`.codex/context-summary-run-full-flow.md`
□ 将使用以下可复用组件：
- `apps/workflow/storyforge_workflow/provider_client.py`：真实 LLM 冒烟调用。
- `scripts/verify-local.ps1`：本地依赖预检。
- `scripts/run-e2e.mjs`：E2E 验证编排。
- `package.json`：根级验证脚本入口。
□ 将遵循命名约定：Python `snake_case`，Node 脚本 `camelCase`，文档简体中文。
□ 将遵循代码风格：不新增代码；复用根脚本；输出摘要化。
□ 确认不重复造轮子：已检查 provider client、LLM 测试、E2E 脚本和本地验证脚本。

### 上下文充分性检查

- 能定义接口契约：输入为 `STORYFORGE_LLM_*` 环境变量，输出为真实 provider 非空响应与脚本退出码。
- 理解技术选型：直接复用项目已有 OpenAI 兼容客户端和根级脚本。
- 识别风险点：网络、Docker、模型名兼容、OpenAPI 文件刷新。
- 知道验证方式：真实 LLM 冒烟、`pnpm run verify`、`pnpm run test`、`pnpm run e2e`、`pnpm openapi`。

### 真实 LLM 连通性冒烟

时间：2026-05-21 20:12:00

- 命令：`uv run python .codex/llm-smoke.py`（在 `apps/workflow` 中执行，使用进程级环境变量注入 LLM 配置）。
- 结果：通过，退出码 0。
- 响应摘要：返回非空中文文本，长度 19，预览为 `StoryForge 连通性测试成功。`
- 注意：PowerShell 外层配置文件加载提示存在，但未影响命令退出码和真实 LLM 响应。

### 项目全流程验证记录

时间：2026-05-21 20:20:00

1. `pnpm run verify`
   - 首次结果：失败，沙箱内无法查询 Docker API，PostgreSQL、Redis、MinIO 状态检查失败。
   - 补救：经授权运行 `docker compose up -d postgres redis minio`，三个容器均处于 Running。
   - 复跑结果：通过，退出码 0。

2. `pnpm run test`
   - 结果：失败，退出码 1。
   - Web/shared：通过，Web 7 项通过，shared `tsc --noEmit` 通过。
   - API：147 项中 146 项通过、1 项失败。
   - 失败点：`apps/api/tests/test_judge_repair.py::test_judge_outputs_structured_issues_and_repair_returns_targeted_patch`。
   - 差异：期望 `左臂仍然受伤`，实际 `左臂仍带着伤`。
3. `pnpm run e2e`
   - 结果：失败，退出码 1。
   - 已刷新 OpenAPI 契约。
   - 契约测试 10 项中 7 项通过、3 项失败。
   - 失败点一：缺少 `apps/web/app/world/page.tsx`。
   - 失败点二：缺少 `apps/web/app/workspace/page.tsx`。
   - 失败点三：Phase 4 前端入口缺少 `Retrieval Center 检索中心` 证据。

4. `pnpm openapi`
   - 结果：通过，退出码 0。
   - 输出：已生成 `packages/shared/src/contracts/storyforge.openapi.json`。

5. 工作区状态
   - `git status --short` 显示仓库已有大量未提交改动；本次新增/修改 `.codex/context-summary-run-full-flow.md`、`.codex/operations-log.md`、`.codex/llm-smoke.py` 和验证报告。

## 修复后复跑 - 根因调查记录

时间：2026-05-21 20:45:00

### 1. API 单测失败根因

- 复现现象：在真实 `STORYFORGE_LLM_API_KEY` 存在时，`apps/api/tests/test_judge_repair.py` 中 `replacement_text` 从期望 `左臂仍然受伤` 变为远程模型返回的 `左臂仍带着伤`。
- 代码路径：`apps/api/app/domains/judge/service.py` 的 `create_judge_issues` 优先调用 `semantic_judge(payload)`，而 `semantic_judge` 会读取 `STORYFORGE_JUDGE_LLM_API_KEY` 或 `STORYFORGE_LLM_API_KEY`。
- 既有测试意图：`apps/api/tests/test_judge_semantic.py` 明确要求 Judge LLM 路径可注入 provider，避免测试依赖真实远程模型。
- 根因结论：API 测试公共环境未隔离真实 LLM 环境变量，导致本地测试不可重复。

### 2. E2E 契约失败根因

- `tests/e2e/phase2-contract.spec.ts` 读取 `apps/web/app/world/page.tsx` 与 `apps/web/app/quality/page.tsx`，当前文件不存在。
- `tests/e2e/phase3-contract.spec.ts` 读取 `apps/web/app/workspace/page.tsx`、`collaboration/page.tsx`、`commercial/page.tsx`、`analytics/page.tsx`，当前文件不存在。
- 当前 `apps/web/app` 实际入口包括：`studio`、`retrieval`、`runs`、`artifacts`、`evaluations`、`providers`、`refinery`、`jobs`、`assets`。
- `README.md` 当前能力边界也只声明 Studio、Retrieval、Runs、Artifacts、Evaluations 等页面级闭环。
- 根因结论：Phase 2/3 E2E 前端契约仍引用旧页面范围，未对齐当前产品边界。

## 修复后复跑 - 执行记录

时间：2026-05-21 21:12:00

### 修复内容

1. `apps/api/tests/conftest.py`
   - 新增 `isolate_remote_llm_env` autouse fixture。
   - 清理 `STORYFORGE_JUDGE_LLM_*`、`STORYFORGE_LLM_API_KEY`、`STORYFORGE_LLM_BASE_URL`，避免真实远程 Judge 污染 API 测试。

2. `tests/e2e/phase2-contract.spec.ts`
   - 移除对已不存在 `world`、`quality` 前端页面和已退役 OpenAPI 端点的断言。
   - 保留当前仍存在的系列记忆、批量精修、风格包和 Refinery 前端边界证据。

3. `tests/e2e/phase3-contract.spec.ts`
   - 移除对已退役工作区、协作、商业化、分析前端页面和 OpenAPI 端点的强制暴露断言。
   - 保留当前事件流、Provider Gateway 和退役边界测试证据。

4. `tests/e2e/phase4-contract.spec.ts`
   - 将首页证据从旧文案对齐为当前 `Retrieval 证据链路` 和 `Evaluations 评测诊断`。
5. `apps/workflow/pyproject.toml` 与 `apps/workflow/tests/conftest.py`
   - 为 workflow pytest 固定项目内 `.pytest-tmp` basetemp。
   - 每个 workflow 测试注入独立 `STORYFORGE_WORKFLOW_SQLITE_PATH`，避免共享 `.runtime` SQLite 造成只读或状态污染。

6. `.gitignore`
   - 忽略 `.pytest-tmp/` 和 `apps/workflow/.runtime/` 运行态文件。

### 复跑结果

- `uv run pytest tests/test_judge_repair.py -q`（带真实 LLM 环境变量）：通过，`1 passed`。
- `node scripts/run-e2e.mjs tests/e2e/phase2-contract.spec.ts tests/e2e/phase3-contract.spec.ts tests/e2e/phase4-contract.spec.ts`：通过，9 项契约测试全通过，并完成 API/workflow 补偿验证。
- `uv run pytest`（`apps/workflow`）：通过，13 项全通过。
- `pnpm run test`（带真实 LLM 环境变量）：通过；Web 7 项通过，shared 类型检查通过，API 147 项通过，workflow 13 项通过。
- `pnpm run e2e`（带真实 LLM 环境变量）：通过；14 项 Node 契约测试通过，API 补偿验证 7 项通过，workflow 补偿验证 8 项通过。
- `pnpm openapi`：通过，OpenAPI 契约已生成。