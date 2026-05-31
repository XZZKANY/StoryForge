## 项目上下文摘要（Task 6 Web 技能链展示）

生成时间：2026-05-31 19:58:50 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/book-runs/audit.tsx`
  - 模式：`BookRunAuditPanel` 从 `bookRun.progress.completed_chapters` 派生章节证据，并以语义化 `section`、`ol`、`ul` 展示。
  - 可复用：`asRecord`、`asRecordArray`、`formatEvidenceValue`、`EvidenceItem`。
  - 需注意：当前只覆盖旧证据链，不展示 `skill_chain`。
- **实现2**: `apps/web/tests/book-run-audit.test.tsx`
  - 模式：使用 `node:test` 与 `renderToStaticMarkup` 对页面 HTML 做静态断言。
  - 可复用：直接扩展现有 fixture 和断言，避免新增测试框架。
  - 需注意：测试应先失败，证明页面尚未渲染技能链。
- **实现3**: `apps/web/app/book-runs/api.tsx`
  - 模式：`BookRunRead.progress` 使用 `Record<string, unknown>`，便于承载扩展型运行进度字段。
  - 可复用：无需扩散类型变更即可读取 `progress.skill_chain`。
  - 需注意：所有字段必须运行时窄化，不能假设 API 数据形状。
- **实现4**: `apps/web/app/book-runs/[id]/audit/page.tsx`
  - 模式：服务器页面读取 BookRun 后渲染 `BookRunAuditPanel`。
  - 可复用：本阶段只改面板，不改路由数据流。
  - 需注意：无 BookRun 或无 `skill_chain` 时页面仍应可读。

### 2. 项目约定

- **命名约定**: React 组件使用 `PascalCase`，函数和变量使用 `camelCase`。
- **文件组织**: BookRun 页面相关组件集中在 `apps/web/app/book-runs`；测试位于 `apps/web/tests`。
- **导入顺序**: Node/React 导入在前，项目相对导入在后。
- **代码风格**: TypeScript strict，语义化 HTML，文案使用简体中文。

### 3. 可复用组件清单

- `BookRunAuditPanel`: 审计页入口组件。
- `asRecord` / `asRecordArray`: 未知 JSON 数据的窄化工具。
- `formatEvidenceValue`: 把未知值转为可展示文本。
- `renderToStaticMarkup`: 现有静态渲染测试方式。

### 4. 测试策略

- **测试框架**: Node 内置 `node:test` + `node:assert/strict`。
- **测试模式**: 对 React 组件静态渲染 HTML 后断言关键文案和引用字段。
- **参考文件**: `apps/web/tests/book-run-audit.test.tsx`。
- **覆盖要求**: 展示 schema、summary、技能事件、input/output 引用；不展示 `prompt`、`final_draft` 或完整正文；无 `skill_chain` 时保留旧行为。

### 5. 依赖和集成点

- **外部依赖**: React 19、Next.js 15、TypeScript；不新增依赖。
- **内部依赖**: `BookRunRead.progress.skill_chain`，来源于 API audit_report 投影或后续 BookRun progress 回填。
- **集成方式**: 在 `BookRunAuditPanel` 内新增技能链区块，不改变读取 BookRun 的路由。
- **配置来源**: `apps/web/package.json` 的 `test` 与 `lint` 脚本，根 `package.json` 的 workspace 命令。

### 6. 技术选型理由

- **为什么用这个方案**: 当前审计页已经集中展示 BookRun 证据链，增量展示 `skill_chain` 最小且一致。
- **优势**: 不新增路由和状态管理；无 `skill_chain` 时兼容旧 BookRun。
- **劣势和风险**: `skill_chain` 是未知 JSON，需要白名单渲染避免泄露大字段。

### 7. 关键风险点

- **并发问题**: 无客户端状态或并发写入。
- **边界条件**: `skill_chain` 缺失、events 为空、refs 非对象、metadata 含嵌套值。
- **性能瓶颈**: 事件列表线性渲染，规模随章节和技能数量增长，当前可接受。
- **敏感字段**: 禁止通用 stringify 完整事件对象，只渲染白名单字段。

### 8. 外部资料与工具记录

- Context7 查询 React 官方文档：列表渲染应使用稳定 `key`，条件渲染可根据数据存在与否切换内容。
- GitHub `search_code` 查询 `"skill_chain" "React" "audit"` 未找到可直接复用实现，仅确认该功能偏项目特定。
- 本环境没有 desktop-commander 可调用工具，已使用 PowerShell 与 `rg` 替代并记录。
