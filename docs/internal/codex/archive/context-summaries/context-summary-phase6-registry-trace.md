## 项目上下文摘要（Phase 6 registry 真实联动前置）

生成时间：2026-05-19 06:50:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/studio/page.tsx`
  - 模式：页面从 `phase6DataSources.studio` 读取静态契约并渲染中文列表。
  - 可复用：统一 registry 与 `source.name/source.output/source.status` 渲染模式。
  - 需注意：当前仅是已有契约但未联通，不应实现 HTTP client。
- **实现2**: `apps/web/app/retrieval/page.tsx`
  - 模式：页面能力清单 + 数据源契约清单分区展示。
  - 可复用：`phase6DataSources.retrieval.map()` 的轻量展示模式。
  - 需注意：真实检索刷新和搜索 API 读取仍待后续单点 spike。
- **实现3**: `apps/web/app/runs/page.tsx`
  - 模式：运行日志页面通过 registry 暴露 JobRun、Checkpoint、ModelRun 和重试契约。
  - 可复用：用 registry 作为页面真实联动前置，不新增状态管理。
  - 需注意：workflow-to-api 真表 adapter/client 仍是已有契约但未持久化。
### 2. 项目约定

- **命名约定**：TypeScript 类型使用 PascalCase，常量使用 camelCase；页面组件使用 `XxxPage`。
- **文件组织**：Phase 6 Web 页面在 `apps/web/app/*/page.tsx`，共享静态契约在 `apps/web/lib/`。
- **导入顺序**：先导入组件或 registry，再定义页面内静态数组。
- **代码风格**：双引号、分号、只读类型字段、中文用户可见文本。

### 3. 可复用组件清单

- `apps/web/lib/phase6-data-sources.ts`：Phase 6 数据源契约统一 registry。
- `apps/web/tests/phase1-navigation.test.tsx`：中文契约测试与 `assertIncludesAll()` 断言模式。
- `docs/architecture/phase6-workbench-contract.md`：业务边界和状态区分的文档事实入口。

### 4. 测试策略

- **测试框架**：Node `node:test` + `node:assert/strict`。
- **测试模式**：源码文本契约测试，验证中文关键字、registry 引用与文档状态边界。
- **覆盖要求**：先写失败断言，再补 registry 字段或文档，最后运行 Web test 与 TypeScript 检查。
### 5. 依赖和集成点

- **外部依赖**：无新增外部库。
- **内部依赖**：五个页面依赖 `phase6DataSources`；契约文档和 TODO 作为执行边界。
- **集成方式**：静态 registry 先统一页面契约，后续从 registry 选择单页面单数据源做真实 API 读取 spike。
- **配置来源**：无运行时配置变更。

### 6. 技术选型理由

- 继续使用 typed registry，避免五个页面重复手写 API 数据源描述。
- 新增追踪字段只提供后续选择依据，不改变渲染行为和架构边界。
- 文档引用代码事实源，降低契约文档与页面 registry 分叉风险。

### 7. 关键风险点

- **边界风险**：不能把本轮扩展成 HTTP client 或大型状态管理。
- **一致性风险**：文档与 registry 名称可能分叉，因此第 2 轮补事实源声明。
- **验证风险**：源码契约测试只能保护静态契约，真实 API 读取仍需后续单点 spike 验证。
