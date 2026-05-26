## 项目上下文摘要（P8-011/P8-012 Web 轮询重试与 evaluations 契约守卫）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/phase8-stage4.test.tsx`
  - 模式：使用 `readFileSync` 读取源码并断言契约字段存在。
  - 可复用：`read(path)` 辅助函数与中文断言消息。
  - 需注意：适合当前缺少 DOM 测试库的客户端组件契约。
- **实现2**: `apps/web/tests/api-client.test.ts`
  - 模式：使用 `node:test`、`assert` 和 `globalThis.fetch` mock 验证 API client。
  - 可复用：本地测试命名、afterEach 还原全局状态的风格。
  - 需注意：本次不修改 API client 或后端 API。
- **实现3**: `apps/web/tests/job-status-core.test.ts`
  - 模式：对解析函数和状态归一化做边界测试。
  - 可复用：对 malformed payload 返回 null/unknown 的契约表达。
  - 需注意：JobStatusPoller 依赖 `parseJobRunSnapshot` 与终态判断。
### 2. 项目约定

- **命名约定**: React 组件 PascalCase，函数 camelCase，API 字段保持 snake_case。
- **文件组织**: 页面位于 `apps/web/app/*/page.tsx`，组件位于 `apps/web/components/*`，测试位于 `apps/web/tests`。
- **导入顺序**: Node/React 依赖在前，项目相对导入在后。
- **代码风格**: TypeScript strict，类型字段大量使用 `readonly`，守卫函数返回 `value is Type`。

### 3. 可复用组件清单

- `apps/web/components/job-status/job-status-core.ts`: `parseJobRunSnapshot`、`isTerminalJobStatus`、`describeJobStatus`。
- `apps/web/lib/api-client.ts`: `readJson` 统一读取和响应校验。
- `apps/web/tests/phase8-stage4.test.tsx`: 源码契约测试模式。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test`，由 `apps/web/scripts/phase1-contract-test.mjs` 转译运行。
- **测试模式**: 以契约测试和小型单元测试为主；当前未发现 jsdom、testing-library 或 react-test-renderer。
- **参考文件**: `phase8-stage4.test.tsx`、`api-client.test.ts`、`job-status-core.test.ts`。
- **覆盖要求**: RED 先覆盖重试触发与 malformed detail 防误渲染，再实现 GREEN。
### 5. 依赖和集成点

- **外部依赖**: React 19、Next 15、TypeScript 5.8。
- **内部依赖**: JobStatusPoller 依赖 `job-status-core`；evaluations 页面依赖 `readJson`。
- **集成方式**: JobStatusPoller 通过 `fetch(endpoint/jobRunId)` 客户端轮询；evaluations 通过服务端 `readJson` 校验 API 响应。
- **配置来源**: `apps/web/package.json` 的 `test` 脚本执行 `node scripts/phase1-contract-test.mjs`。

### 6. 技术选型理由

- **为什么用这个方案**: 项目现有测试未提供 DOM 环境，源码契约测试是既有可运行模式；生产修复保持在现有组件内部。
- **优势**: 不新增依赖、不改 API、不扩大运行时边界。
- **劣势和风险**: JobStatusPoller 的真实点击行为只能通过源码契约间接验证，已用 React 官方 useEffect 依赖文档确认方案。

### 7. 关键风险点

- **并发问题**: 轮询 effect 需要继续清理 timer，并在取消后忽略异步结果。
- **边界条件**: malformed run 与 trend_points 元素必须被拒绝。
- **性能瓶颈**: trend_points 校验为 O(n)，符合现有列表守卫模式。
- **安全考虑**: 本任务不涉及认证、鉴权、加密或审计变更。
