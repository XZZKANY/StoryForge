## 项目上下文摘要（Step D-1a）

生成时间：2026-05-26 00:00:00

### 1. 相似实现分析

- **实现1**: `packages/shared/package.json`
  - 模式：包私有、ESM，当前只有 `test: tsc --noEmit` 和 `typescript` devDependency。
  - 可复用：继续使用 package scripts 管理 shared 包验证。
  - 需注意：新增 `generate:types` 后必须保证 `pnpm run test` 覆盖生成文件。
- **实现2**: `packages/shared/src/index.ts`
  - 模式：集中导出 shared 公共类型。
  - 可复用：继续作为类型出口，新增生成类型导出。
  - 需注意：D-1a 不替换 apps/web 手写类型。
- **实现3**: `packages/shared/tsconfig.json`
  - 模式：`include` 为 `src/**/*.ts`，会纳入 `src/generated/api-types.ts`。
  - 可复用：无需修改 tsconfig。
  - 需注意：生成文件必须能通过严格类型检查。

### 2. 项目约定

- TypeScript 包使用 ESM 和 `export type`。
- 验证脚本使用 `pnpm run ...`。
- 生成文件放在 `src/generated/`，契约快照在 `src/contracts/`。

### 3. 可复用组件清单

- `src/contracts/storyforge.openapi.json`: OpenAPI 输入契约。
- `src/index.ts`: shared 类型导出入口。
- `tsconfig.json`: TypeScript 校验入口。

### 4. 测试策略

- RED：运行 `pnpm run generate:types` 观察脚本缺失。
- GREEN：运行 `pnpm run generate:types && pnpm run test`。
- 检查 `src/generated/api-types.ts` 存在并导出 `paths` / `components` / `operations`。

### 5. 依赖和集成点

- 新增 devDependency：`openapi-typescript`。
- Context7 文档确认 CLI 用法：`openapi-typescript <schema> -o <file>`。
- GitHub search_code 当前无可用工具，已记录检索限制。

### 6. 技术选型理由

- 使用 `openapi-typescript` 是计划指定方案，避免继续维护手写类型。
- 生成类型为编译期产物，不增加运行时代码。

### 7. 风险点

- 依赖安装可能需要网络审批。
- 生成文件可能较大，必须由 CLI 生成而非手写。
- 若生成导出名与预期不同，需先读取文件再决定 index 导出。
