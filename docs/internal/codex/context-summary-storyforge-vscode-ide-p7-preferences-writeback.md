## 项目上下文摘要（P7 个性化偏好写入入口）

生成时间：2026-05-29 03:05:00 +0800

### 1. 相似实现分析

- **实现1**: `components/ide/personalization/preferences.ts`
  - 模式：偏好解析、合并、序列化、localStorage 读写均已抽为纯函数。
  - 可复用：`mergeIdePreferences`、`saveIdePreferences`、`idePreferencesStorageKey`。
  - 需注意：当前只有函数级保存能力，缺少用户在 IDE 中触发保存的 UI。
- **实现2**: `components/ide/shell/IdeShellPreferencesHydrator.tsx`
  - 模式：客户端组件通过 `useSyncExternalStore` 监听 `storage` 与自定义 `storyforge:ide-preferences-change` 事件。
  - 可复用：保存后派发同名事件即可让 Shell 重新水合。
  - 需注意：该事件常量目前未导出，保存组件应复用同一个事件名，避免字符串漂移。
- **实现3**: `components/ide/personalization/PersonalizationPanel.tsx`
  - 模式：服务端可渲染摘要，展示主题、布局、键位。
  - 可复用：可在摘要后嵌入一个 `'use client'` 的控制组件，保持 SSR 摘要不变。
  - 需注意：不要把整个 Shell 改成复杂表单；P7 只需证明主题/键位/布局可持久化。
- **实现4**: `tests/ide-personalization.test.tsx`
  - 模式：用 node:test + renderToStaticMarkup + 源码契约验证个性化行为。
  - 可复用：新增测试断言面板包含保存控件，并扫描客户端组件包含 `saveIdePreferences`、`localStorage`、`dispatchEvent`。

### 2. 项目约定

- **命名约定**：React 组件 PascalCase；测试中文名称。
- **文件组织**：个性化相关文件放 `components/ide/personalization/`。
- **导入顺序**：React/类型在前，项目模块在后。
- **代码风格**：明确 props 类型、只读类型、两空格缩进。

### 3. 可复用组件清单

- `mergeIdePreferences`: 生成主题/布局/键位补丁后的偏好。
- `saveIdePreferences`: 写入本地存储。
- `preferencesChangedEvent`: 应导出供写入端和水合端共用。
- `phase1-contract-test.mjs`: 需加入新客户端组件转译和 import rewrite。

### 4. 测试策略

- **测试框架**：node:test + React SSR + 源码契约扫描。
- **红灯测试**：`PersonalizationPanel` 渲染保存控件；新 `PersonalizationControls.tsx` 必须是客户端组件并调用 `saveIdePreferences(window.localStorage, ...)` 与 `window.dispatchEvent(new Event(preferencesChangedEvent))`。
- **验证命令**：`pnpm --filter @storyforge/web test -- ide-personalization`、`pnpm --filter @storyforge/web lint`。
- **覆盖要求**：用户可在 IDE 内保存主题、布局、键位；保存后触发水合刷新。

### 5. 依赖和集成点

- **外部依赖**：无新增依赖。
- **内部依赖**：PersonalizationPanel 嵌入 PersonalizationControls；Hydrator 复用导出的事件常量。
- **集成方式**：点击按钮写 localStorage 并派发事件，Hydrator 收到事件重新读取。
- **配置来源**：master plan P7 退出标准“用户布局、键位、主题持久化”。

### 6. 技术选型理由

- **为什么补轻量控制组件**：当前缺口是用户入口而非存储模型；最小可审计客户端组件即可满足。
- **优势**：不引入表单库；保留 SSR 摘要和现有测试结构。
- **劣势和风险**：按钮先提供预设切换/保存，不是完整键位编辑器；但已证明端到端写入路径。

### 7. 关键风险点

- **边界条件**：SSR 环境不能访问 window；客户端组件需在事件处理器内访问。
- **一致性**：事件名必须单一来源。
- **可验证性**：node SSR 不能点击按钮，需用源码契约补充交互路径证据。