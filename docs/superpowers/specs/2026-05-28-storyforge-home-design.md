# StoryForge 首页重构设计

生成时间：2026-05-28 02:30:00 +08:00

## 1. 背景与目标

StoryForge 当前首页和工作台页面偏工程验证与功能导航，能清晰呈现 Studio、Retrieval、Runs、Artifacts、Evaluations 等页面边界，但第一眼复杂度较高，创作入口不够聚焦。

本次重构目标是借鉴主流对话应用的视觉骨架和低噪声交互体验，将 StoryForge 首页改造为“创作意图入口”，同时保留项目已有的可验证长篇小说创作流水线逻辑。

本设计只借鉴布局与交互轻量感，不复制第三方产品的业务逻辑。StoryForge 的核心逻辑仍围绕：

- Blueprint 全书蓝图
- BookRun 整书运行
- Studio 审阅与批准写回
- Retrieval 证据核对
- Artifacts 工件与导出
- Runs 运行诊断
- Evaluations 评测诊断
- Providers 配置状态

## 2. 设计原则

1. **视觉骨架接近主流对话应用的新建页**：深色背景、左侧导航、顶部状态胶囊、中央问候语、大输入框、胶囊快捷按钮。
2. **业务语义必须属于 StoryForge**：不出现 Code、Learn、Life stuff 等无关分类，所有入口映射到项目现有能力。
3. **首页从导航页变成创作入口页**：用户先输入创作意图，再进入 Blueprint、BookRun 或 Studio 等具体流程。
4. **第一阶段不改后端契约**：优先使用现有路由与 API，降低风险。
5. **不伪装未联通能力**：尚未接入真实动作的入口必须使用明确跳转或空状态，不展示虚假的完成态。

## 3. 页面结构

### 3.1 总体布局

首页采用两栏布局：

```text
┌──────────────────┬────────────────────────────────────────────┐
│ 左侧导航栏        │ 顶部状态胶囊                               │
│                  │                                            │
│ StoryForge       │           今天要锻造哪段故事？              │
│ 新建作品          │                                            │
│ 搜索作品与证据     │        [ 大输入框 / 创作意图入口 ]          │
│ 作品库            │                                            │
│ Studio 审阅       │  [创建 Blueprint] [启动 BookRun] ...       │
│ BookRun 整书运行  │                                            │
│ Retrieval 证据    │  当前作品 / 运行状态 / 下一步建议           │
│ 工件与导出         │                                            │
│ 运行诊断          │                                            │
│ 最近记录          │                                            │
└──────────────────┴────────────────────────────────────────────┘
```

### 3.2 左侧导航

左侧导航保留垂直列表，但内容替换为 StoryForge 真实入口：

| 文案 | 路由 | 用途 |
| --- | --- | --- |
| 新建作品 | `/blueprints` | 从蓝图入口开始新作品或新全书计划 |
| 搜索作品与证据 | `/retrieval` | 查找资料源、命中、证据锚点 |
| 作品库 | `/studio` | 第一阶段复用 Studio 作品列表能力 |
| Studio 审阅 | `/studio` | 审阅 Scene Packet、Judge、Repair、批准写回 |
| BookRun 整书运行 | `/book-runs` | 查看整书运行状态和章节进度 |
| Retrieval 证据 | `/retrieval` | 核对检索证据链 |
| 工件与导出 | `/artifacts` | 查看导出与制品治理 |
| 运行诊断 | `/runs` | 查看 JobRun、ModelRun、Checkpoint |

左侧“最近”区域显示最近作品、最近 BookRun、待审章节或审计报告摘要。第一阶段可先使用静态安全空状态或现有 API 的可用数据，不能硬编码虚假成功状态。

### 3.3 顶部状态胶囊

顶部状态胶囊用于展示当前运行环境：

```text
Local workspace · Provider 正常
```

第一阶段可以链接到 `/providers`。如果 Provider 状态无法读取，则显示：

```text
Local workspace · Provider 待检查
```

### 3.4 中央主标题

主标题采用创作语气：

```text
今天要锻造哪段故事？
```

副语义由输入框 placeholder 承担，不在首屏堆叠工程解释。

### 3.5 大输入框

输入框是“创作意图入口”，不是普通聊天框。

默认提示文案：

```text
输入故事想法、章节目标或修订要求，StoryForge 会选择对应创作流程。
```

第一阶段行为：

- 用户输入内容后点击“开始”
- 若未选择快捷动作，默认进入 `/blueprints`
- 若选择快捷动作，则跳转到对应现有路由
- 输入内容暂不强行提交到后端，避免新增未验证契约

后续阶段可扩展为 Server Action 或 intent classifier。

### 3.6 快捷动作

快捷动作全部使用 StoryForge 真实概念：

| 快捷动作 | 路由 | 第一阶段行为 |
| --- | --- | --- |
| 创建 Blueprint | `/blueprints` | 跳转到蓝图页面 |
| 启动 BookRun | `/book-runs` | 跳转到整书运行页面 |
| 审阅并批准 | `/studio` | 跳转到 Studio 审阅链路 |
| 核对证据 | `/retrieval` | 跳转到检索证据页 |
| 导出审计 | `/artifacts` | 跳转到工件与导出页 |

### 3.7 当前上下文摘要

输入框下方展示三个轻量状态卡：

1. 当前作品
2. 运行状态
3. 下一步建议

第一阶段允许出现空状态：

```text
当前暂无作品，请先创建 Blueprint。
```

若已有现成 API 可稳定读取，则使用真实数据；否则不得硬编码示例数据作为真实状态。

## 4. 组件拆分

建议新增首页专用组件，避免继续扩大 `app/page.tsx`：

```text
apps/web/app/page.tsx
apps/web/components/home/HomeShell.tsx
apps/web/components/home/HomeSidebar.tsx
apps/web/components/home/HomeComposer.tsx
apps/web/components/home/HomeQuickActions.tsx
apps/web/components/home/HomeContextStrip.tsx
apps/web/components/home/home-data.ts
```

组件职责：

- `HomeShell.tsx`：首页整体布局和深色视觉容器。
- `HomeSidebar.tsx`：左侧导航、最近记录、工作区状态。
- `HomeComposer.tsx`：中央标题、大输入框、开始按钮。
- `HomeQuickActions.tsx`：快捷动作胶囊按钮。
- `HomeContextStrip.tsx`：当前作品、运行状态、下一步建议。
- `home-data.ts`：首页导航项、快捷动作、空状态与可选数据读取函数。

## 5. 数据与路由策略

第一阶段保持低风险：

- 不新增后端接口。
- 不新增数据库字段。
- 不修改 OpenAPI 契约。
- 快捷动作优先跳转已有路由。
- 数据读取仅复用现有 API client 与页面已验证端点。

可复用现有文件：

- `apps/web/lib/api-client.ts`
- `apps/web/components/site-nav/site-nav-links.ts`
- `apps/web/app/studio/api.ts`
- `apps/web/app/book-runs/api.tsx`
- `apps/web/app/blueprints/api.tsx`

## 6. 样式策略

首页采用局部组件样式与 Tailwind class 组合，尽量不破坏全局页面：

- 保留 `apps/web/app/globals.css` 的基础字体和暗色变量能力。
- 首页容器使用深色背景和局部 class。
- 现有 Studio、Retrieval、Runs 等详情页暂不强制改成新首页的极简风格。
- 左侧导航若重构为全局样式，需要确保现有页面仍可访问。

第一阶段优先重构首页；全局导航是否同步改造在实施计划中单独拆分。

## 7. 可访问性与响应式

必须保留基本可访问性：

- 首页主区域使用 `<main>`。
- 导航使用 `<nav aria-label="StoryForge 主导航">`。
- 输入框需要 `aria-label`。
- 快捷动作使用真实链接或按钮，不能只靠点击 div。
- 移动端隐藏左侧栏，保留顶部菜单入口或简化导航。

响应式要求：

- 桌面端：左侧栏 + 中央输入。
- 平板端：左侧栏可折叠。
- 手机端：隐藏左侧栏，主输入框全宽，快捷动作换行。

## 8. 测试策略

第一阶段需要本地验证：

1. Web 单元测试：确认首页渲染核心文案与快捷入口。
2. 导航测试：确认快捷动作链接到正确路由。
3. 可访问性基础测试：确认主标题、输入框 label、导航 label 存在。
4. 现有回归测试：运行项目既有 Web 测试与必要的根验证命令。

建议新增或更新：

- `apps/web/tests/phase1-navigation.test.tsx`
- 或新增 `apps/web/tests/home-page.test.tsx`

## 9. 明确不做范围

本次首页重构不做：

- 不实现完整聊天系统。
- 不实现 AI 意图分类器。
- 不新增后端创作指令接口。
- 不把 Claude 的 Code/Learn/Write/Life stuff 等分类迁入项目。
- 不重写 Studio、Retrieval、Runs 的业务逻辑。
- 不伪造最近作品、BookRun 或 Provider 成功状态。

## 10. 验收标准

重构完成后必须满足：

1. 首页首屏视觉接近主流对话应用的深色极简布局。
2. 所有首页文案和入口均属于 StoryForge 项目业务。
3. 快捷动作可以跳转到现有页面。
4. 没有无关 Claude 分类残留。
5. 移动端可用，输入框和快捷入口不溢出。
6. 本地测试通过，并在 `.codex/verification-report.md` 留痕。
7. 如存在无法读取真实最近数据的情况，页面显示明确空状态，而不是虚假示例数据。

## 11. 后续增强方向

后续可独立规划：

- 接入真实最近作品与最近 BookRun 聚合 API。
- 将输入框接入 Server Action，根据意图进入 Blueprint 或 Studio。
- 增加“附加资料”上传与 Retrieval 绑定。
- 将 Studio 内部页面逐步改造成更低噪声的审阅体验。
- 增加首页命令菜单，支持快速跳转作品、章节和审计报告。
