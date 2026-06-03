## 项目上下文摘要（D-1b Web 共享生成类型）

生成时间：2026-05-26 02:05:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/studio/types.ts`
  - 模式：当前集中导出 Studio 页面使用的 API 响应类型与 UI 状态联合类型。
  - 可复用：保留 `Studio*State` 与 `StudioTarget`，只替换 API 响应形状。
  - 需注意：运行时校验仍在 `validators.ts`，类型替换不能改变页面数据流。
- **实现2**: `apps/web/lib/api-client.ts`
  - 模式：统一 API base URL、API Key 注入、`readJson<T>` 泛型读取。
  - 可复用：在此增加共享 OpenAPI schema 的类型别名，避免各页面重复直接声明 response 类型。
  - 需注意：不要改变 `apiFetch`、`readJson` 运行时行为。
- **实现3**: `packages/shared/src/generated/api-types.ts`
  - 模式：由 `openapi-typescript` 生成 `components["schemas"]`，只作为类型事实源。
  - 可复用：`StudioBookListItem`、`StudioChapterGoalRead`、`StudioScenePacketRead`、`StudioJudgeReviewRead`、`StudioRepairPatchRead`、`StudioApprovalSummaryRead`、`StudioApprovalExecuteRead`、`StudioRecoverySummaryRead`。
  - 需注意：生成类型数组为可变数组，页面状态使用只读属性时不应额外包装导致赋值不兼容。

### 2. 项目约定

- **命名约定**: TypeScript 类型使用 PascalCase；API helper 使用 camelCase；页面状态类型以 `State` 结尾。
- **文件组织**: Studio 领域类型集中在 `app/studio/types.ts`；通用请求能力在 `lib/api-client.ts`。
- **导入顺序**: 先类型/外部导入，再内部相对路径导入。
- **代码风格**: 两空格缩进、双引号、显式 readonly 用于手写 UI 状态。

### 3. 可复用组件清单

- `packages/shared/src/generated/api-types.ts`: OpenAPI 生成 schema 类型。
- `packages/shared/src/index.ts`: 已导出 `components` 等生成类型。
- `apps/web/lib/api-client.ts`: 增加 `ApiSchemas` 与 `ApiResponseSchema` 类型别名供页面复用。
- `apps/web/app/studio/validators.ts`: 保留运行时结构校验。

### 4. 测试策略

- **测试框架**: `node:test` 结构测试，经 `apps/web/scripts/phase1-contract-test.mjs` 转译执行。
- **测试模式**: 先新增结构断言确认共享生成类型被引用，并确认手写字段块被删除。
- **参考文件**: `apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**: 结构测试 + `pnpm run build` 类型检查与 Next 构建。

### 5. 依赖和集成点

- **外部依赖**: `openapi-typescript` 生成结果已在 shared 包中存在。
- **内部依赖**: `apps/web` 依赖 `@storyforge/shared: workspace:*`；`studio/types.ts` 可依赖 `../../lib/api-client` 的类型别名。
- **集成方式**: Web 类型从 shared schema 间接映射；运行时 API client 不改变。
- **配置来源**: `apps/web/package.json` build 使用 `next build`。

### 6. 技术选型理由

- **为什么用这个方案**: 计划要求消除 Web 端手写 API response 类型，shared generated schemas 是 D-1a 已建立的单一契约来源。
- **优势**: 降低 schema drift；保留本地 UI state 类型不影响页面逻辑。
- **劣势和风险**: 生成类型未加 `readonly`，但 TypeScript 可正常读取；若 API schema 变化会在 build 暴露。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: `StudioApprovalExecuteRead` 比旧类型多字段，现有 action 只读取子集，应兼容。
- **性能瓶颈**: 仅类型层改动，无运行时成本。
- **安全考虑**: 本步骤不新增或修改认证逻辑，仅保持既有 API Key 注入。

### 8. 工具替代记录

- sequential-thinking、shrimp-task-manager、desktop-commander 在当前工具列表不可用；已用计划工具、本地文件读取与 PowerShell 记录替代。
- Context7 与 github.search_code 在当前工具列表不可用；本步骤依赖项目内 D-1a 生成类型与现有实现证据。
