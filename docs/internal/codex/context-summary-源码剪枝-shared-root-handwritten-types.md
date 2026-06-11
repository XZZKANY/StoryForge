## 项目上下文摘要（源码剪枝 shared-root-handwritten-types）

生成时间：2026-06-05 14:03:49

### 1. 相似实现分析

- **实现1**: `packages/shared/src/index.ts`
  - 模式：根出口转导 `generated/api-types` 的 `components`、`operations`、`paths`、`webhooks`，并转导 `diagnostic` 领域适配类型和函数。
  - 可复用：保留生成契约和 diagnostic 转导出，不新增根出口手写 API 类型。
  - 需注意：本批只删除无消费者手写类型，不修改生成契约和 diagnostic。
- **实现2**: `packages/shared/src/generated/api-types.ts`
  - 模式：由 `openapi-typescript` 根据 OpenAPI contract 生成 API schema 和 path 类型。
  - 可复用：API 响应和 schema 类型应从 `components["schemas"]`、`paths` 等生成类型消费。
  - 需注意：生成文件不可手工编辑，本批只依赖它作为事实源。
- **实现3**: `packages/shared/src/diagnostic.ts`
  - 模式：提供 Web IDE 真实消费的领域适配类型和转换函数。
  - 可复用：继续通过根出口暴露 `Diagnostic` 与 `judgeIssueToDiagnostic`。
  - 需注意：diagnostic 不是本批剪枝目标。

### 2. 项目约定

- **命名约定**: TypeScript 类型使用 PascalCase，根出口文件只聚合公共契约。
- **文件组织**: shared 包源码位于 `packages/shared/src/`，生成契约位于 `src/generated/`，OpenAPI contract 位于 `src/contracts/`。
- **导入顺序**: 根出口当前先导出生成 API 类型，再导出 diagnostic 类型与函数。
- **代码风格**: shared 包测试通过 `tsc --noEmit` 执行，适合使用 TypeScript 编译型护栏。

### 3. 可复用组件清单

- `packages/shared/src/generated/api-types.ts`: OpenAPI 生成类型事实源。
- `packages/shared/src/diagnostic.ts`: Web IDE 诊断领域适配。
- `packages/shared/tsconfig.json`: `include` 覆盖 `src/**/*.ts`。
- `packages/shared/package.json`: `test` 脚本为 `tsc --noEmit`。
- `apps/web/lib/api-client.ts`: 通过 `@storyforge/shared` 消费 `components` 生成类型。

### 4. 测试策略

- **测试框架**: TypeScript 编译器，命令为 `pnpm --filter @storyforge/shared test`。
- **测试模式**: 先新增 `source-pruning.test.ts`，用 `@ts-expect-error` 断言四个根出口类型不应存在；红灯阶段目标类型仍存在，应触发 TS2578。
- **参考文件**: `packages/shared/src/index.ts`、`packages/shared/tsconfig.json`。
- **覆盖要求**: shared 编译红绿、Web 相关验证、目标符号残留搜索、diff-check。

### 5. 依赖和集成点

- **外部依赖**: `openapi-typescript`、TypeScript。
- **内部依赖**: Web 通过 `@storyforge/shared` 使用 `components` 和 `Diagnostic`；API 领域使用自己的 Provider schema/runtime_config。
- **集成方式**: shared 根出口作为 Web 可导入的公共契约入口。
- **配置来源**: `packages/shared/package.json` 与 `packages/shared/tsconfig.json`。

### 6. 技术选型理由

- **为什么用这个方案**: API schema 类型已有 OpenAPI 生成物，根出口手写重复类型没有消费者，会增加契约漂移风险。
- **优势**: 删除只影响类型层，运行时无行为变化；护栏能防止这些手写类型重新进入根出口。
- **劣势和风险**: 仓库外未记录消费者可能依赖旧手写类型，需在审查报告中记录。

### 7. 关键风险点

- **并发问题**: 无运行时并发影响。
- **边界条件**: 不能删除 `Diagnostic`、`components`、`operations`、`paths`、`webhooks` 转导出。
- **性能瓶颈**: 无运行时代码变更；编译护栏增加的 tsc 成本极低。
- **安全考虑**: 不修改认证、鉴权、API client、OpenAPI contract 或生成脚本。

### 8. 外部依据

- Context7 查询 `openapi-typescript` 官方文档：生成类型可通过 `components["schemas"]` 与 `paths` 消费 schema 和响应类型，生成类型用于静态分析且基本无运行时代价。
- GitHub `search_code` 查询到多个开源 TypeScript 客户端采用根出口转导生成的 `components`、`operations`、`paths` 形态，支持本项目保留生成契约、删除手写重复类型的方向。

### 9. 上下文充分性检查

- 能定义清晰契约：是，shared 根出口不应继续导出四个目标手写类型。
- 理解技术选型理由：是，OpenAPI 生成物是 API 类型事实源。
- 识别主要风险点：是，主要风险是仓库外旧导入和误删 diagnostic。
- 知道如何验证实现：是，使用 shared tsc 红绿、Web 验证、残留搜索和 diff-check。
