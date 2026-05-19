## 项目上下文摘要（Phase 6 单数据源 spike）

生成时间：2026-05-19 07:35:00 +08:00

### 1. 相似实现分析

- **实现1**：`apps/web/lib/phase6-data-sources.ts`
  - 模式：统一 `phase6DataSources` registry 保存五个页面的数据源契约。
  - 可复用：`Phase6DataSource` 类型、`withTrace()` 追踪字段注入、Studio 第一个数据源“作品列表 API”。
  - 需注意：当前状态是“已有契约但未联通”，不能伪装成已实现 API 读取。
- **实现2**：`apps/web/app/studio/page.tsx`
  - 模式：页面从 `phase6DataSources.studio` 渲染数据源契约。
  - 可复用：同一 registry 的页面映射，避免新增页面级重复数据源。
  - 需注意：本轮如增加首个 spike 提示，只做页面可见边界，不做 HTTP client。
- **实现3**：`apps/web/tests/phase1-navigation.test.tsx`
  - 模式：使用 `assertIncludesAll()` 做源码中文契约测试。
  - 可复用：先红后绿的文本契约断言，保护 registry、页面与文档关键词。
  - 需注意：测试保护的是契约与边界，不代表真实 API 已联通。
### 2. 项目约定

- **命名约定**：TypeScript 类型 PascalCase，导出常量 camelCase。
- **文件组织**：Web 页面在 `apps/web/app/*/page.tsx`，共享契约在 `apps/web/lib/`，测试在 `apps/web/tests/`。
- **导入顺序**：先导入组件和 registry，再定义页面常量。
- **代码风格**：双引号、分号、中文用户可见文本，状态区分写清楚。

### 3. 可复用组件清单

- `phase6DataSources`：五个 Phase 6 页面共同使用的数据源契约事实源。
- `Phase6DataSource`：单个数据源的页面、文档章节、下一步动作、输入输出和状态类型。
- `assertIncludesAll()`：中文源码契约断言工具。

### 4. 测试策略

- 使用 `pnpm --filter @storyforge/web test` 运行 Node 源码契约测试。
- 使用 `pnpm --filter @storyforge/web exec tsc --noEmit` 验证 TypeScript 类型。
- 每轮先用文本或源码契约产生红灯，再补最小实现或文档。
### 5. 依赖和集成点

- **外部依赖**：无新增依赖。
- **内部依赖**：Studio 页面与契约测试依赖 `phase6DataSources`。
- **集成方式**：先选择 `phase6DataSources.studio[0]` 作为首个真实读取 spike 起点，后续再单独实现读取验证。
- **配置来源**：无新增环境变量。

### 6. 技术选型理由

- 继续使用 typed registry 是最小变更，能防止后续代理绕过现有事实源。
- 先锁定单页面单数据源，能降低从静态入口到真实 API 联动的范围风险。
- 不引入 HTTP client，可遵守当前“禁止全量 client、不一次性联通五页”的边界。

### 7. 关键风险点

- **范围扩张**：不能把“选择首个 spike”扩展成全量 API client。
- **状态误报**：必须继续标明“已有契约但未联通”。
- **验证不足**：本轮只保护契约，真实 API 可复现读取需下一轮单独验证。
