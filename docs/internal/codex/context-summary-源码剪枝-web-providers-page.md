## 项目上下文摘要（源码剪枝 web-providers-page）

生成时间：2026-06-05 10:24:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/providers/page.tsx`
  - 模式：Next App Router `page.tsx` 公开路由叶子，当前页面只渲染静态 Provider 能力列表。
  - 可复用：无真实交互组件或 API client 复用。
  - 需注意：删除该文件会有意下线 `/providers` 公开页面。
- **实现2**: `apps/web/app/settings/SettingsClient.tsx`
  - 模式：设置页客户端容器，组合 `ProviderSettingsPanel` 和 `CreativePreferencesPanel`。
  - 可复用：`ProviderSettingsPanel` 已承担 Provider Base URL 保存、模型检测和模型列表展示。
  - 需注意：`apps/web/tests/settings-page.test.ts` 明确保护 `/settings` 导航和首页账号入口。
- **实现3**: `apps/workflow/storyforge_workflow/tools/registry.py`
  - 模式：`CreativeToolRegistry` 以 `page_refs`、`api_paths`、`workflow_nodes` 描述运行时工具事实源。
  - 可复用：保留 `provider_gateway.resolve` 的 schema、能力、API 路径和 workflow node，仅迁移页面引用。
  - 需注意：当前 `provider_gateway.resolve` 仍引用 `apps/web/app/providers/page.tsx`，删除页面前必须同步修正。
- **实现4**: `apps/web/tests/source-pruning.test.ts` 与 `apps/workflow/tests/test_source_pruning.py`
  - 模式：剪枝防回归测试通过文本和文件存在性检查防止已下线代码回归。
  - 可复用：继续使用 `existsSync`、`readFileSync`、`pathlib.Path.read_text` 进行轻量护栏。
  - 需注意：先扩展测试产生红灯，再做删除和迁移。

### 2. 项目约定

- **命名约定**: TypeScript 测试使用 `node:test`，测试标题使用简体中文；Python 测试函数使用 `test_` 前缀。
- **文件组织**: Web 页面位于 `apps/web/app/<route>/page.tsx`；Workflow 工具事实源位于 `apps/workflow/storyforge_workflow/tools/registry.py`。
- **导入顺序**: Web 测试保持 Node 内置模块导入在前，项目模块导入在后；Python 测试保持标准库导入在前。
- **代码风格**: Web 使用 TypeScript、React 与 Tailwind；Workflow 使用 Python 3.11，ruff 规则包含 E/F/W/I/UP/B/SIM。

### 3. 可复用组件清单

- `apps/web/app/settings/ProviderSettingsPanel.tsx`: Provider 设置真实交互入口。
- `apps/web/app/settings/SettingsClient.tsx`: 设置页容器，保留 Provider Gateway 语义。
- `apps/web/tests/source-pruning.test.ts`: Web 剪枝防回归测试入口。
- `apps/workflow/tests/test_source_pruning.py`: Workflow 剪枝防回归测试入口。
- `apps/workflow/storyforge_workflow/tools/registry.py`: runtime tools 页面/API/Workflow 引用事实源。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`，Workflow 使用 `pytest`。
- **测试模式**: 先扩展 source-pruning 红灯测试，再删除静态页面并迁移 registry 引用。
- **参考文件**: `apps/web/tests/settings-page.test.ts`、`apps/web/tests/source-pruning.test.ts`、`apps/workflow/tests/test_source_pruning.py`、`apps/workflow/tests/test_creative_tool_registry.py`。
- **覆盖要求**: 验证 `/providers` 页面文件不存在、主导航不含 `/providers`、registry 不再引用已删页面并指向 `/settings` 真实入口。

### 5. 依赖和集成点

- **外部依赖**: Next.js App Router。Context7 官方文档确认 `page.tsx` 会使对应 route segment 公开可访问。
- **内部依赖**: Workflow registry 通过 API runtime-tools 暴露给 Web Runs 诊断；registry 页面引用不能指向已删除文件。
- **集成方式**: 仅替换 `provider_gateway.resolve` 的 `page_refs` 字符串，不改变 API provider gateway 或 workflow provider execution 行为。
- **配置来源**: Web 测试脚本来自 `apps/web/package.json`，Workflow pytest 配置来自 `apps/workflow/pyproject.toml`。

### 6. 技术选型理由

- **为什么用这个方案**: `/settings` 已经承接 Provider 配置和模型检测，是当前真实交互入口；`/providers` 仅静态说明，保留会造成重复职责和错误运行时引用。
- **优势**: 下线占位路由，减少维护面；runtime tools 诊断指向真实入口。
- **劣势和风险**: 外部用户直接访问 `/providers` 会失效；当前仓库主导航、首页入口和测试契约未保护该路由。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: `/assets` 虽也是静态页，但 `apps/web/app/jobs/page.tsx` 仍链接 `/assets`，本批不处理。
- **性能瓶颈**: 删除静态页面和迁移字符串引用无性能风险。
- **安全考虑**: 不修改 Provider API Key、Provider Base URL 检测、API 鉴权或服务端代理逻辑。
