## 项目上下文摘要（源码剪枝 assistant-workflows）

生成时间：2026-06-05 03:42:55 +08:00

### 1. 相似实现分析

- **剪枝回归测试**: `apps/web/tests/source-pruning.test.ts`
  - 模式：使用 `existsSync` 断言已下线文件不应继续存在。
  - 可复用：在同一测试文件追加 `assistant-workflows.ts` 的防回归断言。
  - 需注意：删除前先运行该测试，确认红灯由目标文件存在触发。
- **Assistant 首页契约测试**: `apps/web/tests/home-page.test.tsx`
  - 模式：静态读取首页相关文件，断言真实入口、组件和工具事件解析器存在。
  - 可复用：用于判定 `assistant-tool-events.ts` 仍被项目契约要求保留。
  - 需注意：该测试未要求 `assistant-workflows.ts` 存在。
- **Assistant workflow 专属测试**: `apps/web/tests/assistant-workflows.test.ts`
  - 模式：只测试 `assistant-workflows.ts` 自身导出的流程模板和规划函数。
  - 可复用：无。删除目标模块后该测试应同步删除，避免测试只维护未接入规划代码。

### 2. 项目约定

- **命名约定**：TypeScript 函数使用 camelCase，测试文件使用短横线命名。
- **文件组织**：运行时首页能力位于 `apps/web/components/home`，对应测试位于 `apps/web/tests`。
- **导入顺序**：Node 内置模块在前，项目模块在后。
- **代码风格**：Web 测试使用 `node:test` 和 `assert`，断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 剪枝防回归测试。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 测试执行入口。
- `apps/web/components/home/assistant-tool-catalog.ts`: 当前运行链路中的工具事实源之一，保留。
- `apps/web/components/home/assistant-tool-node-mapper.ts`: 当前首页工具节点映射事实源，保留。

### 4. 测试策略

- **红灯测试**：更新 `source-pruning.test.ts` 后运行 `pnpm --filter @storyforge/web test source-pruning`，应因 `assistant-workflows.ts` 仍存在而失败。
- **绿灯测试**：删除 `assistant-workflows.ts` 与 `assistant-workflows.test.ts` 后重跑 `source-pruning`，应通过。
- **目标回归**：运行 `pnpm --filter @storyforge/web test` 与 `pnpm --filter @storyforge/web lint`。
- **静态验证**：引用搜索确认 Web 业务源码不再引用 `assistant-workflows`、`planAssistantWorkflow`、`listAssistantWorkflowTemplates`。

### 5. 依赖和集成点

- **外部依赖**：Node.js `node:test`、TypeScript、pnpm workspace。
- **内部依赖**：`assistant-workflows.ts` 依赖 `assistant-tool-catalog.ts`，但未被 Web 页面或组件消费。
- **配置来源**：`apps/web/package.json`、`apps/web/tsconfig.json`。

### 6. 技术选型理由

- **为什么删除**：该模块是静态流程规划模板，当前只被专属测试覆盖，未进入首页 UI、Server Actions、session store 或工具节点映射链路。
- **为什么不同步删除 tool-events**：`home-page.test.tsx` 明确要求 `assistant-tool-events.ts` 提供事件解析函数，说明它仍是计划内契约。
- **为什么不删除 longform.py**：Workflow `longform.py` 有 CLI、恢复、重试和长文生成测试覆盖，证据不足以作为本轮死代码。

### 7. 关键风险点

- **历史文档残留**：`docs/superpowers/plans/2026-06-02-storyforge-assistant-workflow.md` 仍记录创建/修改该文件的历史计划，保留为归档。
- **未来需求风险**：若未来需要 Assistant 流程编排，应从真实 UI/事件链路重新接入，而不是保留未消费模板。
- **验证风险**：当前工作区已有上一批剪枝和其他用户改动，本轮只关注目标文件、source-pruning 和 `.codex` 留痕。
