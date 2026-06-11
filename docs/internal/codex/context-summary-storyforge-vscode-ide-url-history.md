# 项目上下文摘要（StoryForge IDE URL 回退与面板状态）

生成时间：2026-05-28 19:11:37 +08:00

### 1. 相似实现分析

- **实现1**: pps/web/components/ide/url/ide-url-state.ts
  - 模式：集中 parse/serialize /ide 的 workspace/book/tab/active/inspector/artifact/panel 状态。
  - 可复用：parseIdeUrlState、serializeIdeUrlState。
  - 需注意：当前只有字符串转换，没有浏览器历史栈提交辅助函数。
- **实现2**: pps/web/app/ide/page.tsx
  - 模式：服务端读取 searchParams，调用 parseIdeUrlState 恢复初始 IDE 状态，再按 inspector/memory/artifact query 读取真实数据。
  - 可复用：URL 作为分享真相源的单向恢复路径。
  - 需注意：页面级恢复只发生在服务端渲染/刷新时，客户端按钮点击尚未把状态写回 URL。
- **实现3**: pps/web/components/ide/shell/IdeShell.tsx
  - 模式：客户端 shell 管理 leftPanel/tabs/activeTabId 等临时交互状态。
  - 可复用：现有 openTab 和 panel state。
  - 需注意：当前 setLeftPanel 只改 React state，不调用 history.pushState；BottomPanel 也没有 onSelect 回调。
- **实现4**: pps/web/tests/ide-url-state.test.ts 与 ide-components.test.tsx
  - 模式：Node 原生测试验证 URL 编解码和 SSR 可观察属性。
  - 可复用：新增 URL 合并/路径生成测试和 SSR data 属性测试。
  - 需注意：SSR 测试不能证明真实浏览器 popstate，但能约束集成点和可观察状态。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase，React 组件 PascalCase；测试名使用中文业务描述。
- **文件组织**: URL 纯函数放在 components/ide/url/；壳层交互放在 components/ide/shell/；测试放在 pps/web/tests/。
- **导入顺序**: React/类型导入在前，项目组件和工具后置，遵循现有 Prettier。
- **代码风格**: 2 空格缩进、单引号、readonly 类型优先。

### 3. 可复用组件清单

- parseIdeUrlState / serializeIdeUrlState: URL 真相源转换。
- createInitialIdeState: 从 URL state 归一化 shell 初始状态。
- ActivityBar: 左侧面板点击入口。
- BottomPanel: 底部面板切换入口。

### 4. 测试策略

- **测试框架**: Web 使用
ode:test +
ode:assert/strict，通过 pps/web/scripts/phase1-contract-test.mjs 转译运行。
- **测试模式**: 先新增失败测试要求 URL patch 能保留既有 share 状态，并要求 shell SSR 暴露 active panel data 属性与 bottom panel active 按钮。
- **覆盖要求**: URL helper 正常流程、面板状态可观察属性、底部面板按钮 aria-pressed。

### 5. 依赖和集成点

- **外部依赖**: 浏览器 window.history.pushState 与 popstate，不新增 npm 依赖。
- **内部依赖**: IdeShell 与 BottomPanel，以及 URL 纯函数。
- **集成方式**: Shell 点击时提交 URL；浏览器后退触发 popstate 后重新解析 URL 并恢复面板/tab 状态。
- **配置来源**: master plan §8 URL 状态、§10 P0 URL 可分享与回退。

### 6. 技术选型理由

- **为什么用这个方案**: 继续使用 Next searchParams + 浏览器 History API，不引入 hash router 或新状态库。
- **优势**: URL 继续是分享真相源，客户端状态能和浏览器回退对齐。
- **劣势和风险**: 当前测试仍不是 Playwright 浏览器级证据；需后续用真实浏览器验证点击/后退。

### 7. 关键风险点

- **并发问题**: React state 与 URL 同步需避免双主；本轮只在用户显式点击时 pushState，popstate 时单向恢复。
- **边界条件**: URL 无 tab 时回退到 legacy:studio；未知 panel 仍按现有 parse 规则透传。
- **性能瓶颈**: URL 序列化成本极低。
- **安全考虑**: 仅处理本地 URL query，不读取凭据。
