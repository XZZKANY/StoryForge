## 项目上下文摘要（Provider/API Key 系统设置归属）

生成时间：2026-06-01 19:04:11 +08:00

### 1. 相似实现分析

- **实现1**: `docs/superpowers/specs/2026-06-01-home-input-first-uiux-design.md`
  - 模式：Assistant 首页规格先定义左侧栏、问候语、消息流，再定义集成点与验证策略。
  - 可复用：`Customize 创作偏好` 的职责边界已经限定为文风、题材偏好、Assistant 行为和默认流程。
  - 需注意：原文把 Provider/API Key 写为“工作区状态或设置入口”，需要补充为账号/工作区菜单下的系统设置，避免与左侧创作入口混淆。
- **实现2**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页顶部工作区状态胶囊链接 `/settings`，将 Provider 状态作为系统状态暴露。
  - 可复用：`homeWorkspaceLabel` 和 `homeProviderUncheckedLabel` 的轻量状态入口。
  - 需注意：该入口适合被规格描述为账号/工作区菜单或状态菜单的一部分，而不是主创作导航。
- **实现3**: `apps/web/app/settings/SettingsClient.tsx`
  - 模式：设置页作为 Provider 连接配置界面，提供 Provider Base URL 保存与检测。
  - 可复用：`storyforge-provider-settings`、`Provider Base URL`、`检测并拉取模型` 的系统设置语义。
  - 需注意：现有测试明确不渲染 API Key 输入框，说明密钥不应被设计成创作偏好，也不应贸然落入前端表单。
- **实现4**: `apps/web/tests/settings-page.test.ts`
  - 模式：用静态文本断言保护设置入口、Provider Base URL 和不渲染密钥输入框。
  - 可复用：后续实现账号/工作区菜单时可沿用该类文本契约测试。
  - 需注意：本轮只更新规格，不新增测试。

### 2. 项目约定

- **命名约定**: 文档标题使用中文主题；前端组件 PascalCase；路由使用小写英文路径。
- **文件组织**: 设计规格位于 `docs/superpowers/specs/`；过程记录位于项目本地 `.codex/`。
- **导入顺序**: 本轮不修改代码导入。
- **代码风格**: 文档使用简体中文、Markdown 标题和短列表；不新增占位符。

### 3. 可复用组件清单

- `apps/web/components/home/HomeShell.tsx`: 首页顶部工作区/Provider 状态入口。
- `apps/web/components/home/HomeSidebar.tsx`: 左侧栏底部工作区状态展示。
- `apps/web/app/settings/SettingsClient.tsx`: Provider Base URL 系统设置页。
- `apps/web/tests/settings-page.test.ts`: 设置页与导航入口的静态契约测试。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` 与项目内静态文件断言，根命令通过 `pnpm --filter @storyforge/web test` 调用。
- **测试模式**: 本轮为文档规格修改，执行文本检索验证关键语义；不运行完整 Web 测试。
- **参考文件**: `apps/web/tests/settings-page.test.ts`。
- **覆盖要求**: 验证规格中同时出现账号/工作区菜单、Provider/API Key 系统设置归属、Customize 边界。

### 5. 依赖和集成点

- **外部依赖**: 本轮无新增外部依赖。
- **内部依赖**: 首页 Assistant 规格依赖现有 `/settings`、`/providers`、Provider Gateway 和工作区状态展示。
- **集成方式**: 规格层明确账号/工作区菜单承载系统设置；后续实现可从顶部状态胶囊或左侧栏底部工作区状态进入。
- **配置来源**: Provider Base URL 当前保存到浏览器 localStorage；API Key 仍遵循服务端或工作区安全配置边界，不写入 Customize。

### 6. 技术选型理由

- **为什么用这个方案**: Provider/API Key 是运行环境与凭据问题，属于系统设置；Customize 是创作偏好，属于内容生成和 Assistant 协作方式。
- **优势**: 信息架构边界清晰，避免用户在创作偏好里处理敏感凭据，也避免左侧主创作入口膨胀。
- **劣势和风险**: 后续需要设计账号/工作区菜单的具体交互，否则当前只在顶部状态和设置页之间保持文字约束。

### 7. 关键风险点

- **并发问题**: 不涉及运行时并发。
- **边界条件**: API Key 不应出现在前端创作偏好表单；Provider 状态未知时必须显示待检查。
- **性能瓶颈**: 不涉及性能改动。
- **安全考虑**: 不新增密钥输入或存储路径；沿用既有设置页“不渲染密钥输入框”的测试约束。

### 8. 外部参考

- GitHub code search 查询 `"Provider Base URL" "Settings" "localStorage" language:TypeScript`，结果显示开源 AI 应用通常把 Provider 配置放入 settings/store 层；本轮只借鉴“系统设置归属”原则，不复制实现。

### 9. 充分性检查

- 能定义接口契约：是，本轮不改接口，只定义信息架构归属。
- 理解技术选型理由：是，Provider/API Key 是系统配置，Customize 是创作偏好。
- 识别主要风险：是，主要风险是敏感凭据被误放入偏好表单或主创作入口。
- 知道如何验证：是，用文本检索验证规格、日志和报告包含关键归属语义。
