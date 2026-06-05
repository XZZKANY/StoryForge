## 项目上下文摘要（源码剪枝 Web JobStatusPoller 默认端点）

生成时间：2026-06-05 14:42:05 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/job-status/JobStatusPoller.tsx`
  - 模式：客户端组件用 `useEffect` 和 `fetch()` 按 `endpoint` + `jobRunId` 轮询 JobRun 快照。
  - 可复用：保留 `endpoint` prop 覆盖、`retryAttempt`、`parseJobRunSnapshot()`、`isTerminalJobStatus()`。
  - 需注意：组件仍被 Studio 使用，不能作为死代码删除。
- **实现2**: `apps/web/app/runs/page.tsx`
  - 模式：Runs 页面使用 `readJson()` 读取真实 JobRun 状态 API 前缀 `/api/model-runs/job-runs`。
  - 可复用：真实端点前缀与后端 OpenAPI 契约一致。
  - 需注意：本批不迁移 Runs 页面，只复用端点证据。
- **实现3**: `apps/web/tests/phase8-stage4.test.tsx`
  - 模式：通过源码测试保护 `JobStatusPoller` 的客户端属性、解析依赖和重试 effect 依赖。
  - 可复用：在同一测试中补充默认端点契约，避免只检查组件存在。
  - 需注意：测试应继续保留 `retryAttempt` 和 effect 依赖护栏。
- **实现4**: `apps/web/tests/source-pruning.test.ts`
  - 模式：用源码护栏表达过期模块、过期路径和转译残留不得回归。
  - 可复用：读取目标源码并断言 forbidden 字符串不存在。
  - 需注意：红灯应命中 `/api/v1/jobs` 旧默认端点。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，常量和函数使用 camelCase，测试标题使用简体中文。
- **文件组织**: 轮询组件位于 `components/job-status/`，核心解析逻辑位于 `job-status-core.ts`，页面契约测试位于 `tests/phase8-stage4.test.tsx`。
- **导入顺序**: Node 内置模块、测试依赖、项目相对导入。
- **代码风格**: TypeScript 单引号、尾逗号、`readonly` 类型和简体中文断言说明。

### 3. 可复用组件清单

- `apps/web/components/job-status/job-status-core.ts`: JobRun 状态标准化、终态判断和快照解析。
- `apps/web/components/job-status/JobStatusPoller.tsx`: 客户端轮询 UI，保留 endpoint prop。
- `apps/web/app/runs/page.tsx`: 真实 JobRun 状态 API 前缀 `/api/model-runs/job-runs` 的 Web 使用证据。
- `apps/api/app/domains/model_runs/router.py`: 后端 `GET /api/model-runs/job-runs/{job_run_id}` 路由。
- `packages/shared/src/contracts/storyforge.openapi.json`: OpenAPI 中存在真实 JobRun 状态路径，不存在 `/api/v1/jobs`。

### 4. 测试策略

- **测试框架**: Node `node:test`，通过 `pnpm --filter @storyforge/web test -- ...` 运行。
- **测试模式**: 先新增 source-pruning 与 phase8-stage4 红灯护栏，再修改默认端点让测试转绿。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/phase8-stage4.test.tsx`、`apps/web/tests/job-status-core.test.ts`。
- **覆盖要求**: 旧 `/api/v1/jobs` 不得残留，真实 `/api/model-runs/job-runs` 默认端点存在，组件重试与解析能力保留。

### 5. 依赖和集成点

- **外部依赖**: React `useEffect`、`useCallback`、`useRef`、`useState`，浏览器 `fetch()`。
- **内部依赖**: `JobStatusPoller` 被 `apps/web/app/studio/page-content.tsx` 使用，`job-status-core.ts` 被组件与测试复用。
- **集成方式**: 默认端点与 `jobRunId` 拼接为 `/api/model-runs/job-runs/{jobRunId}`；调用方仍可通过 `endpoint` prop 覆盖。
- **配置来源**: 本批不新增环境变量或 Next rewrite；真实 API 端点由 OpenAPI 和 model_runs router 提供。

### 6. 技术选型理由

- **为什么用这个方案**: 组件仍有生产调用方，直接删除会破坏 Studio；旧默认端点无后端契约，剪掉默认值是最小且可验证的维护面收敛。
- **优势**: 修复默认行为与真实 API 契约不一致的问题，同时保留组件扩展能力。
- **劣势和风险**: `/jobs` 静态页面仍是后续候选，本批不解决页面壳问题，避免扩大范围。

### 7. 关键风险点

- **并发问题**: 不改变轮询间隔、重试状态或 effect 依赖。
- **边界条件**: `endpoint` prop 仍允许测试或未来调用方传入自定义前缀。
- **性能瓶颈**: 网络轮询次数不变。
- **安全考虑**: 不新增 API 路由，不绕过既有 API 契约；真实后端路径仍受 API 层控制。
