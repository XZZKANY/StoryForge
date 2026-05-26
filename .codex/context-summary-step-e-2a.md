## 项目上下文摘要（Step E-2a Web API 客户端单元测试）

生成时间：2026-05-26 14:06:34 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：使用 `node:test` 与 `node:assert/strict` 编写本地测试，测试名称和断言消息使用简体中文。
  - 可复用：中文断言风格、`process.cwd()` 作为 `apps/web` 根目录。
  - 需注意：现有测试主要是静态契约检查，缺少函数级运行断言。
- **实现2**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：用 TypeScript `transpileModule()` 将测试文件写入临时目录，再通过 `node --test` 执行。
  - 可复用：临时目录创建、转译、`spawnSync` 执行和 `finally` 清理。
  - 需注意：当前脚本只运行 `phase1-navigation.test.tsx`，新增测试不会被 `pnpm test` 覆盖。
- **实现3**: `apps/web/lib/api-client.ts`
  - 模式：集中封装 API base URL、API Key header、查询参数拼接、`cache: "no-store"` 和 `readJson()` 错误转换。
  - 可复用：`getApiBaseUrl()`、`apiFetch()`、`readJson()` 作为 E-2a 测试对象。
  - 需注意：`apiFetch()` 依赖全局 `fetch`、`Headers`、`Response`，测试需隔离全局替换。

### 2. 项目约定

- **命名约定**: TypeScript 函数和变量使用 camelCase，类型使用 PascalCase，测试文件使用 `*.test.ts` 或 `*.test.tsx`。
- **文件组织**: Web 测试放在 `apps/web/tests/`，本地测试脚本放在 `apps/web/scripts/`。
- **导入顺序**: Node 内置模块在前，项目相对导入在后。
- **代码风格**: 测试描述、断言消息、错误文案使用简体中文；脚本使用 ESM。

### 3. 可复用组件清单

- `apps/web/lib/api-client.ts`: API 客户端函数级测试对象。
- `apps/web/scripts/phase1-contract-test.mjs`: 可扩展的 TypeScript 转译测试执行器。
- `apps/web/tests/phase1-navigation.test.tsx`: 现有 `node:test` 测试风格参考。

### 4. 测试策略

- **测试框架**: Node.js 内置 `node:test`，使用 `node:assert/strict`。
- **测试模式**: 函数级单元测试，临时替换 `globalThis.fetch` 和 `process.env`。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**: `apiFetch()` 注入 `X-StoryForge-API-Key`，`getApiBaseUrl()` 尊重环境变量，`readJson()` 处理错误响应。

### 5. 依赖和集成点

- **外部依赖**: Node.js `node:test`、TypeScript `transpileModule()`，已通过 Context7 查询 Node.js 文档确认 ESM 导入与清理钩子模式。
- **内部依赖**: `api-client.test.ts` 通过临时转译后的 `../lib/api-client.mjs` 引用 API client。
- **集成方式**: `pnpm test` 调用 `apps/web/scripts/phase1-contract-test.mjs`，脚本发现并运行 `tests/*.test.ts(x)`。
- **配置来源**: `apps/web/package.json` 的 `test` 脚本。

### 6. 技术选型理由

- **为什么用这个方案**: 项目当前没有 Vitest/Jest 依赖，继续使用既有 `node:test` 和转译脚本可以避免新增测试框架。
- **优势**: 改动范围小，符合现有脚本风格，`pnpm test` 能覆盖新增测试。
- **劣势和风险**: 手写转译器需要维护测试依赖映射；本步骤只纳入当前 API client 依赖。

### 7. 关键风险点

- **并发问题**: 单元测试会替换全局 `fetch` 和环境变量，必须在每个测试后恢复。
- **边界条件**: 已有 header 传入时，API Key 应覆盖为当前环境值。
- **性能瓶颈**: 测试文件数量少，逐文件转译成本可忽略。
- **安全考虑**: 本步骤仅验证本地开发 API Key 注入行为，不新增安全控制。

