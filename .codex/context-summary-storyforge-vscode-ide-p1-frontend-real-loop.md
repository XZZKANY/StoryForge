## 项目上下文摘要（storyforge-vscode-ide-p1-frontend-real-loop）

生成时间：2026-05-28 22:14:44

### 1. 相似实现分析

- **实现1**: pps/web/components/ide/workflows/JudgeRepairWorkbench.tsx
  - 模式：组合 ChapterEditor、ProblemsPanel、DiffViewer，所有写操作通过 CommandRegistry.execute。
  - 可复用：commandArgs、commands.execute、epairResult / pprovalResult 展示入口。
  - 需注意：当前 Quick Fix 只透传诊断参数，未附带后端 judge.repair 必需的 content，且未从后端 patch payload 推导 Diff。
- **实现2**: pps/web/components/ide/panels/ProblemsPanel.tsx
  - 模式：诊断列表渲染 quick fix 按钮，点击回调传回完整 Diagnostic。
  - 可复用：Diagnostic.quickFixes[].args 是 Repair 命令基础参数。
  - 需注意：组件本身不应知道章节正文，正文应由工作流层补入。
- **实现3**: pps/web/components/ide/views/DiffViewer.tsx
  - 模式：纯展示修复前后正文，并通过 pproveCommandId / pproveArgs 暴露写回命令。
  - 可复用：后端 RepairPatchRead 的 id 可映射为 judge.approve 的 epair_patch_id。
  - 需注意：后端 repair 响应只返回 target span 与 replacement，不返回完整 after，需要前端按局部替换计算。
- **实现4**: pps/web/components/ide/commands/registry.ts
  - 模式：统一注册与执行命令；默认远程执行由 command-client.ts 调 /api/ide/commands/{id}。
  - 可复用：组件点击只调用 registry，不直接调用 API。
  - 需注意：异步命令失败要保留可视错误，避免 UI 静默失败。
- **实现5**: packages/shared/src/diagnostic.ts
  - 模式：judgeIssueToDiagnostic 把后端 issue 映射为 IDE Diagnostic，quick fix 参数包含 issue_id 与 scene_id。
  - 可复用：前端只需要在工作流层补 content，不修改共享诊断契约。

### 2. 项目约定

- **命名约定**: React 组件 PascalCase；工具函数 camelCase；命令 ID 点分命名。
- **文件组织**: P1 工作流逻辑保留在 pps/web/components/ide/workflows/JudgeRepairWorkbench.tsx，测试保留在 pps/web/tests/ide-components.test.tsx。
- **导入顺序**: React/类型导入在前，项目内相对导入在后。
- **代码风格**: 简体中文 UI 文案；props 与类型字段使用 readonly；不新增依赖。

### 3. 可复用组件清单

- ProblemsPanel: 触发 quick fix 的 UI。
- DiffViewer: 展示 repair patch 应用后的 before/after 与 approve 按钮。
- CommandRegistry: 所有写命令的唯一执行入口。
- IdeCommandResponse: 后端命令响应类型。

### 4. 测试策略

- **测试框架**:
ode:test + enderToStaticMarkup，由 pnpm --filter @storyforge/web test 执行。
- **测试模式**: 对纯辅助函数做命令响应契约测试；对组件 SSR 做 data 属性与状态文案测试。
- **参考文件**: pps/web/tests/ide-components.test.tsx、pps/web/tests/ide-command-registry.test.tsx。
- **覆盖要求**: repair 命令参数必须包含 content；后端 patch payload 必须能转换为可视 Diff；approve 结果必须能显示 udit_event_id。

### 5. 依赖和集成点

- **外部依赖**: React 19、Node test。
- **内部依赖**: JudgeRepairWorkbench → CommandRegistry → executeIdeCommand → /api/ide/commands/{id}。
- **集成方式**: 工作流层负责把诊断、正文和后端响应适配为 DiffViewer 输入。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 后端已真实化，前端只需补工作流适配，不应改共享诊断契约或 ProblemsPanel 组件职责。
- **优势**: 改动集中、可测试，继续满足“写操作经 CommandRegistry”。
- **劣势和风险**: 组件内异步状态仍是轻量实现，完整浏览器 E2E 还需后续补强。

### 7. 关键风险点

- **并发问题**: 连续点击 repair/approve 可能产生竞态；本轮保留最新命令结果为准。
- **边界条件**: patch 缺少 target span 时应保留原文并显示错误或空状态；命令失败需可见。
- **性能瓶颈**: 字符串替换为单次局部操作，对 P1 文本规模影响可控。
- **安全考虑**: 仅保留审计链路，不新增安全设计。
