## 项目上下文摘要（StoryForge VS Code IDE P2 Context Inspector）

生成时间：2026-05-28 15:28:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/ide/views/ContextInspector.tsx`
  - 模式：纯展示组件，展示预算、注入块、裁剪块、debug summary 和快照缺失提示。
  - 可复用：`ContextSnapshot`、`ContextInspectorEntry`、`snapshot evicted at ...` 空状态。
  - 需注意：entries 目前没有标准 `data-context-entry-href`，也不生成 `/ide?inspector=...`。
- **实现2**: `apps/api/tests/test_ide_context_snapshot.py`
  - 模式：真实编译并持久化 Context，再通过 `/api/ide/context-snapshot/{id}` 回放。
  - 可复用：验证 injected/dropped 数量、原因、token budget 和 evicted 404 文案。
  - 需注意：后端快照契约已具备，前端还缺 URL inspector 状态。
- **实现3**: `apps/web/components/ide/url/ide-url-state.ts`
  - 模式：解析 `/ide` query 中 workspace、book、tab、active、panel.left、panel.bottom。
  - 可复用：URL 是 IDE 分享和回放的真相源，适合加入 `inspector=<compiled_context_id>`。
  - 需注意：当前 `IdeUrlState` 不含 `inspector`，序列化会丢失 Context Inspector 回放入口。
- **实现4**: `apps/web/components/ide/workflows/JudgeRepairWorkbench.tsx`
  - 模式：组合 Judge → Problems → Repair → Diff → Approve，所有写命令走 `CommandRegistry`。
  - 可复用：Repair/Approve 所在边界可提供只读上下文入口。
  - 需注意：P2 入口必须是只读 href/data 属性，不新增写路径。

### 2. 项目约定

- **命名约定**: React 组件 PascalCase，URL 状态字段 camelCase，后端数据字段 snake_case。
- **文件组织**: URL 状态在 `apps/web/components/ide/url/`，组件契约测试在 `apps/web/tests/`。
- **导入顺序**: Node 内置模块、React、项目组件依次导入。
- **代码风格**: `readonly` props，SSR 可断言 `data-*` 属性，文档与测试文案使用简体中文。

### 3. 可复用组件清单

- `ContextInspector`: 快照展示和 evicted 提示。
- `parseIdeUrlState` / `serializeIdeUrlState`: `/ide` URL 真相源。
- `JudgeRepairWorkbench`: Repair/Approve 侧上下文入口宿主。
- `/api/ide/context-snapshot/{id}`: 后端快照回放端点。

### 4. 测试策略

- **测试框架**: `node:test` + `node:assert/strict`；React 静态渲染使用 `renderToStaticMarkup`。
- **测试模式**: 先扩展 URL 状态测试，确认 `inspector` 不再丢失；再扩展组件测试确认 `/ide?inspector=ctx_unit` 链接和 data 属性存在。
- **参考文件**: `apps/web/tests/ide-url-state.test.ts`、`apps/web/tests/ide-components.test.tsx`。
- **覆盖要求**: ModelRun/Repair/Approve 入口可指向 compiled_context_id；evicted 状态显式展示；后端 API 已有独立测试。

### 5. 依赖和集成点

- **外部依赖**: React 静态渲染，URLSearchParams。
- **内部依赖**: ContextInspector entries、IDE URL 状态和 Workbench。
- **集成方式**: `/ide?inspector=<compiled_context_id>` 作为分享和回放入口。
- **配置来源**: 无新增环境配置。

### 6. 技术选型理由

- **为什么用这个方案**: 主计划已规定 URL 是分享和回放真相，`inspector` 已在路由设计中出现，补 URL 状态和只读链接是最小一致改动。
- **优势**: 不新增网络层，不新增写路径，契约容易测试。
- **劣势和风险**: 当前仍是 SSR/契约入口，不是浏览器真实加载快照；后续需把 IDE 页面实际数据加载接入 API。

### 7. 关键风险点

- **并发问题**: 无新增异步状态。
- **边界条件**: `inspector` 缺失时不应序列化空参数。
- **性能瓶颈**: 仅 URL 字段和小列表链接，无运行时负担。
- **安全考虑**: 本任务不涉及安全控制；新增入口只读。
