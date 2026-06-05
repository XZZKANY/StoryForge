## 项目上下文摘要（源码剪枝 assistant-tool-events）

生成时间：2026-06-05 04:09:50 +08:00

### 1. 相似实现分析

- **剪枝回归测试**: `apps/web/tests/source-pruning.test.ts`
  - 模式：对已下线文件使用 `existsSync` 断言“不应继续存在”。
  - 可复用：追加 `assistant-tool-events.ts` 的防回归断言。
  - 需注意：删除前先跑红灯，确认失败只由目标文件存在触发。
- **首页静态契约测试**: `apps/web/tests/home-page.test.tsx`
  - 模式：读取首页组件源码，断言真实首页链路、BookRun 映射、Server Action 和工具树契约。
  - 可复用：保留真实链路断言；删除只要求 `assistant-tool-events.ts` 存在的规划式测试块。
  - 需注意：该测试块只读取未消费模块本身，没有验证生产导入或 UI 行为。
- **真实工具节点映射**: `apps/web/components/home/assistant-tool-node-mapper.ts`
  - 模式：把真实 BookRun 快照映射为 `AssistantToolNode[]`。
  - 可复用：这是当前生产工具树事实源，应保留。
  - 需注意：不要修改该文件或 `AssistantToolTree.tsx`。

### 2. 项目约定

- **命名约定**：TypeScript 函数使用 camelCase；测试标题和断言消息使用简体中文。
- **文件组织**：生产首页组件位于 `apps/web/components/home`，测试位于 `apps/web/tests`。
- **导入顺序**：Node 内置模块优先，项目模块后置。
- **代码风格**：Web 静态契约测试使用 `node:test`、`assert` 和源码字符串断言。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 剪枝防回归护栏。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 测试执行入口。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: 真实 BookRun 到工具节点的映射。
- `apps/web/components/home/AssistantToolTree.tsx`: 接收真实 `toolNodes` 并渲染工具树。

### 4. 测试策略

- **红灯测试**：更新 `source-pruning.test.ts` 后运行 `pnpm --filter @storyforge/web test source-pruning`，应因 `assistant-tool-events.ts` 仍存在而失败。
- **绿灯测试**：删除 `assistant-tool-events.ts` 并移除 `home-page.test.tsx` 的规划式静态测试块后重跑 `source-pruning`。
- **目标回归**：运行 `pnpm --filter @storyforge/web test` 和 `pnpm --filter @storyforge/web lint`。
- **静态验证**：引用搜索确认 Web 业务源码不再引用 `assistant-tool-events`、`parseAssistantToolEvent`、`parseAssistantToolEvents`、`mapAssistantToolEventsToNodes`。

### 5. 依赖和集成点

- **外部依赖**：Node.js `node:test`、TypeScript、pnpm workspace。
- **内部依赖**：当前真实工具树链路为 `AssistantConversation` 读取 BookRun，`assistant-tool-node-mapper.ts` 生成节点，`AssistantToolTree.tsx` 渲染节点。
- **配置来源**：`apps/web/package.json`、`apps/web/tsconfig.json`。

### 6. 技术选型理由

- **为什么删除**：`assistant-tool-events.ts` 解析抽象工具事件，但当前没有生产导入，也没有真实事件源调用它。
- **为什么修改 home-page.test.tsx**：该测试块只强制未消费解析器存在，会把规划代码伪装为当前契约，应移除。
- **为什么保留真实工具树链路**：`assistant-tool-node-mapper.ts` 和 `AssistantToolTree.tsx` 已被首页真实 BookRun 状态测试覆盖，是当前运行事实源。

### 7. 关键风险点

- **未来事件流风险**：若后续接入 SSE/tool events，应从真实事件 API 开始重新设计解析器并加消费测试。
- **误删风险**：删除前后必须确认生产源码无 `assistant-tool-events` 导入。
- **历史文档风险**：历史计划文档仍记录该文件创建意图，保留为归档，不作为当前运行时事实。
