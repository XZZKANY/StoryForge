## 项目上下文摘要（P0 旧路由 308 重定向）

生成时间：2026-05-29 02:05:00 +0800

### 1. 相似实现分析

- **实现1**: `apps/web/next.config.ts`
  - 模式：Next 配置集中声明构建输出、headers 与 Sentry 包装。
  - 可复用：`NextConfig` 对象中已有 `async headers()`，适合追加 `async redirects()`。
  - 需注意：不要破坏 `withSentryConfig(nextConfig, ...)` 包装；新增函数应保持纯配置。
- **实现2**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：用 `readFileSync` 静态读取关键配置和页面，断言路由/契约不漂移。
  - 可复用：适合新增“旧路由必须 308 跳转到 `/ide`”静态契约测试，无需启动 Next 服务。
  - 需注意：该文件已有大量导航契约，新增断言应聚焦 P0 迁移要求。
- **实现3**: `apps/web/tests/ide-url-state.test.ts`
  - 模式：IDE URL 状态是可分享真相，测试使用 `node:test` 与 `assert.equal/deepEqual`。
  - 可复用：目标跳转 URL 应显式写成 `/ide?...`，避免状态双主。
  - 需注意：旧页面兼容期仅路由到 IDE，不在旧页面内继续新增业务逻辑。

### 2. 项目约定

- **命名约定**：测试名称使用中文描述行为；配置常量使用 camelCase。
- **文件组织**：Next 配置位于 `apps/web/next.config.ts`；导航契约测试集中在 `apps/web/tests/phase1-navigation.test.tsx`。
- **导入顺序**：Node 内置模块在前，测试工具随后；配置文件先导入类型与插件。
- **代码风格**：TypeScript 单引号、对象数组声明、两空格缩进。

### 3. 可复用组件清单

- `apps/web/next.config.ts`: 追加 `redirects()` 配置。
- `apps/web/tests/phase1-navigation.test.tsx`: 静态契约测试入口。
- `apps/web/scripts/phase1-contract-test.mjs`: 本地 `node:test` 执行器。

### 4. 测试策略

- **测试框架**：`node:test` + `node:assert/strict`。
- **测试模式**：先写失败测试，断言 `next.config.ts` 包含 legacy redirect 的 source/destination/permanent 配置。
- **验证命令**：`pnpm --filter @storyforge/web test -- phase1-navigation`、`pnpm --filter @storyforge/web lint`。
- **覆盖要求**：覆盖 `/studio`、`/retrieval`、`/runs`、`/artifacts`、`/evaluations` 五个旧入口。

### 5. 依赖和集成点

- **外部依赖**：Next.js `redirects()` 配置，不新增包。
- **内部依赖**：旧页面仍保留；重定向由 Next 配置层统一处理。
- **集成方式**：`next.config.ts` 返回 redirect 数组，`permanent: true` 在 Next 中对应 308。
- **配置来源**：master plan 第 7 节与 P0 Day-1 清单第 5 项。

### 6. 技术选型理由

- **为什么用 redirects()**：Next 官方配置层可表达永久重定向，不需要新增 middleware 文件或运行时代码。
- **优势**：改动小、可静态验证、与现有配置集中管理一致。
- **劣势和风险**：静态测试不能发起真实 HTTP 请求；如需端到端状态码验证，后续可补 Next 启动级测试。

### 7. 关键风险点

- **边界条件**：目标 URL 需要保留 master plan 指定的 IDE 面板语义。
- **性能影响**：配置级重定向无业务渲染开销。
- **回退策略**：删除 `redirects()` 即可恢复旧页面直接访问。