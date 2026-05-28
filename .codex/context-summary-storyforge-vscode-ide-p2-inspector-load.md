## 项目上下文摘要（StoryForge VS Code IDE P2 Inspector 快照加载）

生成时间：2026-05-28 13:35:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/ide/page.tsx`
  - 模式：Next.js App Router 页面以 `searchParams: Promise<Record<string, string | string[] | undefined>>` 读取 URL，再调用 `parseIdeUrlState`。
  - 可复用：服务端页面可在传入 `IdeShell` 前完成只读数据加载。
  - 需注意：当前只传 URL 状态，不读取 `/api/ide/context-snapshot/{id}`。
- **实现2**: `apps/web/lib/api-client.ts`
  - 模式：`readJson` 包装 `apiFetch`，默认 `cache: 'no-store'`，返回 `ApiResult<T>`。
  - 可复用：只读快照加载可沿用 `readJson`，避免新增请求客户端。
  - 需注意：写路径仍必须走 CommandRegistry，本任务只读。
- **实现3**: `apps/web/components/ide/shell/EditorArea.tsx`
  - 模式：根据 active tab 渲染 legacy、diff 或占位视图。
  - 可复用：增加 `inspectorId`/`contextSnapshot` 分支渲染 `ContextInspector`。
  - 需注意：`IdeShell` 是 client component，不能在其中直接执行服务端数据加载。
- **实现4**: `apps/api/tests/test_ide_context_snapshot.py`
  - 模式：后端已验证 `/api/ide/context-snapshot/{id}` 返回 budget、injected/dropped、debug_summary，缺失时返回 `snapshot evicted at unknown`。
  - 可复用：前端只需消费既有 API 契约。
  - 需注意：evicted 404 需要显式展示，不能静默回到默认编辑器。

### 2. 项目约定

- **命名约定**: URL 状态字段 camelCase，API payload 字段保持 snake_case，React 组件 PascalCase。
- **文件组织**: 页面读取留在 `apps/web/app/ide/`，壳层状态在 `components/ide/shell/`，API 工具在 `lib/`。
- **导入顺序**: React/组件导入优先，内部工具按相对路径导入。
- **代码风格**: `readonly` props、SSR 可断言 `data-*` 属性、简体中文文案。

### 3. 可复用组件清单

- `readJson`: 只读 REST 查询包装。
- `ContextInspector`: 快照展示和 evicted 提示。
- `IdeShell` / `EditorArea`: IDE 壳层和编辑区渲染入口。
- `parseIdeUrlState`: `/ide` URL 真相源。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`，React 使用 `renderToStaticMarkup`。
- **测试模式**: 先新增红灯测试，验证 IDE 页面读取 `inspector` 后调用快照 API；再补组件测试验证 `IdeShell`/`EditorArea` 渲染真实 `ContextInspector` 和 evicted 状态。
- **参考文件**: `apps/web/tests/api-client.test.ts`、`apps/web/tests/ide-components.test.tsx`、`tests/e2e/ide-judge-repair.spec.ts`。
- **覆盖要求**: 正常快照、404 evicted、URL inspector 入口均有本地证据。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router 服务端组件、React 静态渲染。
- **内部依赖**: `readJson`、`ContextInspector`、`IdeShell`、`EditorArea`、后端 context snapshot API。
- **集成方式**: `/ide?inspector=<compiled_context_id>` 触发页面服务端只读加载，结果透传给编辑区。
- **配置来源**: `STORYFORGE_API_BASE_URL` 和 `STORYFORGE_API_KEY` 继续由 `api-client.ts` 管理。

### 6. 技术选型理由

- **为什么用这个方案**: 主计划要求 URL 是分享和回放真相；Next.js 官方文档支持 async Page 读取 `searchParams` 并在服务端用 `fetch({ cache: 'no-store' })` 动态加载数据。
- **优势**: 不新增客户端请求状态机，不新增写路径，SSR 契约容易验证。
- **劣势和风险**: 仍不是浏览器点击式测试；真实 ModelRun/Repair/Approve 旁自动入口仍需后续切片。

### 7. 关键风险点

- **并发问题**: 单次页面服务端读取，无共享状态。
- **边界条件**: 快照 404 必须转为 evicted 提示；响应结构错误必须显示错误而非误渲染。
- **性能瓶颈**: 仅在 URL 带 inspector 时加载一次快照。
- **安全考虑**: 本任务仅只读查询，不新增认证、鉴权或写入逻辑。
