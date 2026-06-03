# StoryForge Assistant 对话式首页设计

生成时间：2026-06-01 17:37:25 +08:00

## 1. 背景与目标

StoryForge 首页不再定位为“输入后跳转到其他页面”的入口页，而是升级为 **StoryForge Assistant 对话式首页**。用户在同一个大界面里输入创作目标，Assistant 在消息流中展示理解、规划、工具调用、阶段进度、产物摘要和下一步操作。

用户已确认的设计方向：

- 使用 **Assistant** 命名，而不是普通输入框或表单。
- 对话框是首页核心，体验接近 AI 助手。
- 工具流程直接显示在对话消息里。
- 不要模式切换按钮。
- 不区分多套展示模式。
- 工具流程树采用单层统一展示：中文阶段、工具名、耗时、tokens、tool uses 和状态合并在同一棵树里。

本设计目标是让用户看到“AI 助手正在做什么”，并能在同一界面继续追问、暂停、调整目标、查看审计或批准下一步。

## 2. 范围

### 2.1 本次做

- 将首页改造成 StoryForge Assistant 对话式界面。
- 保留左侧 StoryForge 会话与工作区导航。
- 中央区域改为对话消息流。
- 底部输入框改为“给 StoryForge Assistant 发送消息”。
- Assistant 消息内展示单层工具流程树。
- 工具流程树展示阶段、工具名、状态、耗时、tokens、tool uses 和简短说明。
- 支持流程级操作按钮：展开全部、只看当前步骤、暂停流程、查看审计。
- 右侧产物栏是否保留可在实施计划中根据页面密度决定，但核心流程必须在对话中完成。

### 2.2 本次不做

- 不展示任何模式切换按钮。
- 不设计双层展示。
- 不把用户带回传统多页表单流程作为主路径。
- 不新增独立设计系统。
- 不伪造已经完成的后端能力。
- 不一次性重构所有 IDE、Studio、BookRun 页面。

## 3. 核心界面结构

### 3.1 左侧栏

左侧栏负责低噪声导航和会话上下文：

- StoryForge 标识。
- `New project 新建项目`：创建新的作品项目。
- `Projects 项目`：管理作品、蓝图、章节和 BookRun 进度。
- `Artifacts 产物`：管理正文、导出文件、审计报告和版本追溯。
- `Customize 创作偏好`：管理文风、题材偏好、Assistant 行为和默认流程。
- 最近对话或最近项目，例如三章试读生成、章节修订审阅、导出审计报告。
- 本地工作区、账号菜单和 Provider 状态。

左侧栏不承载主要创作步骤，避免用户注意力离开对话。
不展示参考界面中与 StoryForge 无关的对话聚合入口和代码入口。

### 3.1.1 大屏动态问候

初始界面的主问候语必须基于现实时间和登录用户动态生成，不写死具体姓名。

时间段建议：

- 05:00-08:59：早上好
- 09:00-11:29：上午好
- 11:30-13:29：中午好
- 13:30-17:59：下午好
- 18:00-04:59：晚上好

用户名来源优先级：

1. 登录用户 display name。
2. 账号用户名。
3. 本地工作区名。
4. 回退为“创作者”。

示例：

```text
下午好，Yotei
今天要锻造哪段故事？
```

`Customize 创作偏好` 只处理创作偏好和 Assistant 协作方式；Provider、API Key、运行环境、语言、帮助、升级和退出等系统设置必须放在账号/工作区菜单或设置入口，避免语义混淆。

### 3.1.2 账号/工作区菜单

账号/工作区菜单承载系统级动作，视觉上可以从左侧栏底部的工作区状态或顶部 Provider 状态胶囊进入，但不进入左侧主创作导航。

建议菜单项：

- `Settings 设置`：进入模型、Provider、运行环境和语言等系统设置。
- `Provider/API Key`：查看 Provider 连接状态、配置指引和凭据来源说明；API Key 不放入 `Customize 创作偏好`。
- `Help 帮助`：打开使用说明、故障排查或本地验证指引。
- `Upgrade 升级`：后续商业化或工作区能力入口。
- `Sign out 退出`：账号退出或断开工作区。

安全边界：

- 前端不得在创作偏好中新增 API Key 输入框。
- 若后续需要密钥配置，必须复用既有服务端/工作区凭据边界，并提供本地可验证的安全说明。
- Provider 未配置或无法检测时，账号/工作区菜单和状态胶囊都应显示“待检查”，不能展示虚假的正常状态。

### 3.2 中央 Assistant 消息流

中央区域是核心工作区：

1. 用户消息：显示用户输入的创作目标。
2. Assistant 回复：先用自然语言确认目标。
3. 工具流程树：在同一条或相邻 Assistant 消息中展示执行流程。
4. 操作按钮：允许展开、查看当前步骤、暂停、查看审计。

对话流中的工具流程树必须是主信息源，不能只放在右侧或隐藏面板里。

### 3.3 底部输入框

底部输入框保留简洁结构：

- placeholder：`给 StoryForge Assistant 发送消息`
- 左侧可提供附件入口，用于附加资料、世界观或上章摘要。
- 右侧发送按钮。

禁止出现用户已否定的模式按钮或模式标签。

### 3.4 可选右侧产物栏

右侧产物栏可用于显示当前产物摘要：

- Blueprint 草稿
- 当前章节生成进度
- 审计线索

但右侧栏只是辅助。工具流程和关键状态必须仍在消息流里展示。

## 4. 单层工具流程树

### 4.1 展示原则

工具流程树只保留一层用户可见结构，不拆成普通/专家两套。

每个流程节点可以同时展示：

- 中文阶段：用户理解当前在做什么。
- 工具名：用户知道 Assistant 调用了哪个能力。
- 状态：已完成、运行中、等待、失败、需要批准。
- 耗时：例如 `4s`、`2m 45s`。
- tokens：用于透明展示成本和规模。
- tool uses：用于透明展示调用次数。
- 子说明：一句话解释当前工具正在处理什么。

### 4.2 示例形态

```text
* 生成三章试读 · 2m 45s · 7.7k tokens · thought for 8s
├─ 已完成：分析创作目标 · 4s · Goal.analyze
│  └─ 提取题材、主角、核心冲突、章节数量和交付物
├─ 已完成：创建 Blueprint 草稿 · 8s · Blueprint.create · 2 tool uses · 1.8k tokens
│  ├─ 生成主线、人物、设定、三章节奏
│  └─ 检查现有世界观与连续性约束
├─ 运行中：生成章节正文 · Chapter.generate · running · 5.4k tokens
│  └─ 正在调用 Chapter.generate...
│     └─ 扩写开场冲突、炼器体系和宗门覆灭线索
├─ 等待：Judge 质量审阅 · Judge.review · waiting
│  └─ 将检查节奏、设定冲突、角色一致性
└─ 等待：修复建议 · Repair.suggest · waiting
   └─ 若审阅发现问题，将生成可批准的修订方案
```

### 4.3 状态表达

- 已完成：使用稳定的浅绿色或低饱和状态色。
- 运行中：使用强调色，并允许轻微动效。
- 等待：降低透明度，但保留可读性。
- 失败：使用明确错误色，并提供重试或查看详情按钮。
- 需要批准：使用醒目的操作色，必须提供用户可点击的批准或调整入口。

### 4.4 工具映射

首批工具流程节点建议映射到现有业务能力：

- `Goal.analyze`：分析用户输入目标。
- `Blueprint.create`：创建或更新蓝图草稿。
- `Retrieval.search`：检索资料、世界观、连续性证据。
- `Chapter.generate`：生成章节正文。
- `Judge.review`：评审节奏、设定、角色一致性和质量问题。
- `Repair.suggest`：生成修复建议。
- `Approval.apply`：用户批准写回。
- `Artifact.export`：导出 Markdown、EPUB 或审计报告。

## 5. 交互流程

### 5.1 新建创作

1. 用户在底部输入目标。
2. Assistant 回复已理解目标。
3. 工具流程树出现，并开始运行 `Goal.analyze`。
4. `Blueprint.create` 完成后展示蓝图摘要。
5. `Chapter.generate` 运行时展示正在生成章节正文。
6. `Judge.review` 等待章节完成后自动进入。
7. 若存在问题，`Repair.suggest` 提供修复建议。
8. 用户可以批准、调整目标、暂停流程或查看审计。

### 5.2 调整目标

1. 用户在对话框输入“把主角改成女炼器师，减少宗门线”。
2. Assistant 新增一段工具流程树。
3. 流程树展示 `Goal.update`、`Blueprint.update` 和必要的 `Chapter.regenerate`。
4. 用户可看到新旧目标差异和工具执行状态。

### 5.3 失败与重试

1. 某个工具节点失败。
2. 流程树将该节点标为失败。
3. Assistant 在节点下方显示失败原因摘要。
4. 用户可选择重试、调整输入、跳过或查看详情。

## 6. 与现有项目的集成点

### 6.1 前端复用

- `apps/web/components/home/HomeShell.tsx`：可演进为 Assistant 首页容器。
- `apps/web/components/home/HomeSidebar.tsx`：可复用为 Assistant 会话侧栏。
- `apps/web/components/home/HomeComposer.tsx`：需改造成 Assistant 输入框。
- `apps/web/components/ide/views/BookRunPanel.tsx`：可复用运行状态和命令表达。
- `apps/web/components/ide/workflows/JudgeRepairWorkbench.tsx`：可复用 Judge、Repair、Approve 的流程语义。
- `apps/web/components/ide/views/ArtifactViewer.tsx`：可复用导出与追溯摘要。
- `apps/web/lib/api-client.ts`：继续作为 API 请求入口。

### 6.2 后端和事件来源

Assistant 工具流程树应优先消费现有事实源：

- BookRun 进度和 checkpoint。
- Judge report。
- Repair patch。
- Approval writeback。
- Artifact trace。
- SSE 或轮询事件。

若现有 API 缺少统一 Assistant trace，实施计划应先定义前端适配层，把现有状态映射成 `AssistantToolNode`，而不是立即新增大而全后端框架。

## 7. 数据结构建议

前端可定义统一节点形状：

```ts
type AssistantToolNode = {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly status: 'completed' | 'running' | 'waiting' | 'failed' | 'needs_approval';
  readonly elapsedLabel?: string;
  readonly tokenLabel?: string;
  readonly toolUseLabel?: string;
  readonly summary: string;
  readonly children?: readonly AssistantToolNode[];
};
```

该类型仅作为前端展示契约，实施时应尽量从现有 API 响应和命令审计中映射。

## 8. 可访问性与响应式

- 工具流程树应使用列表结构表达层级。
- 运行中、失败、等待等状态不能只依赖颜色，必须有文字。
- 输入框必须保留可访问 label。
- 操作按钮必须是原生 button 或 Link。
- 窄屏下左侧栏可隐藏或折叠，但对话和输入框必须可用。

## 9. 验证策略

### 9.1 自动化测试

建议新增或更新：

- `apps/web/tests/home-page.test.tsx`
  - 首页渲染 StoryForge Assistant。
  - 不包含用户已否定的模式按钮文案。
  - 底部输入框显示 `给 StoryForge Assistant 发送消息`。
  - 工具流程树包含中文阶段与工具名。
- 新增 `apps/web/tests/assistant-tool-tree.test.tsx`
  - 渲染 completed、running、waiting、failed、needs_approval 状态。
  - 渲染 tokens、tool uses、elapsed 信息。
  - 渲染子节点层级和状态文字。

### 9.2 本地命令

实施后至少运行：

```powershell
pnpm --filter @storyforge/web test
pnpm --filter @storyforge/web lint
```

若改动触及根布局、全局导航或 API 契约，再运行：

```powershell
pnpm verify
```

### 9.3 视觉检查

实施后检查：

- 对话框是否是首页核心。
- 工具流程树是否出现在 Assistant 消息里。
- 是否没有用户已否定的模式按钮。
- 阶段、工具名、耗时、tokens、tool uses 是否在同一流程树中清晰展示。
- 长流程是否可折叠或至少不会挤爆页面。

## 10. 风险与控制

- **信息过载风险**：tokens 和 tool uses 会增加技术感。控制方式是用低权重颜色展示，并优先突出中文阶段和状态。
- **伪造流程风险**：不得展示未真实执行的成功状态。没有事实源时必须显示等待、未连接或示例预览。
- **范围膨胀风险**：Assistant 首页先做工具流程可视化和对话框骨架，再逐步接真实命令和事件流。
- **后端耦合风险**：前端先建立映射层，复用现有 BookRun、Judge、Repair、Artifact 事实源。

## 11. 验收标准

1. 首页主体验是 StoryForge Assistant 对话，而不是传统表单。
2. 用户输入框位于底部，文案为 `给 StoryForge Assistant 发送消息`。
3. Assistant 消息中展示单层工具流程树。
4. 工具流程树同时包含中文阶段、工具名、状态、耗时、tokens 和 tool uses。
5. 页面不出现用户已否定的模式按钮或模式文案。
6. 不伪造未执行成功的工具状态。
7. Web 测试和 TypeScript 检查通过。
8. `.codex/verification-report.md` 记录本地验证、评分和风险。
