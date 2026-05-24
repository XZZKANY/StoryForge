## 项目上下文摘要（Studio 步骤流）

生成时间：2026-05-24 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/studio/page-content.tsx:1-295`
  - 模式：Next App Router Server Component 聚合 API 状态后一次性渲染 Studio 区块。
  - 可复用：`readStudioBooks`、`readStudioChapterGoal`、`readStudioScenePacket`、`readStudioJudgeReview`、`readStudioApprovalSummary`。
  - 需注意：`page.tsx` 保持薄入口，Server Action 独立在 `actions.tsx`。
- **实现2**: `apps/web/app/retrieval/page.tsx:1-280`
  - 模式：先读取主列表，再按状态读取后续区块；idle/error/ready 三态文案清晰。
  - 可复用：按状态控制下游区块可用性的页面组织方式。
  - 需注意：页面不夸大未联通能力，错误信息用 `role="status"`。
- **实现3**: `apps/web/tests/phase1-navigation.test.tsx:1-142`
  - 模式：使用 `node:test` 做源码级契约测试，读取文件并断言结构、文案和依赖边界。
  - 可复用：新增 Studio 交互契约可沿用源码断言，避免引入测试库。
  - 需注意：测试描述、断言信息必须使用简体中文。
### 2. 项目约定

- **命名约定**：TypeScript 类型使用 PascalCase，函数使用 camelCase，状态联合类型用 `status: "idle" | "ready" | "error"`。
- **文件组织**：`apps/web/app/studio/page.tsx` 为薄入口，页面主体在 `page-content.tsx`，API 读取在 `api.ts`，Server Action 在 `actions.tsx`。
- **导入顺序**：先外部或跨目录组件，再本模块 action/API/type。
- **代码风格**：严格 TypeScript、React JSX、只读 props；文案和断言使用简体中文。

### 3. 可复用组件清单

- `apps/web/app/studio/api.ts`: Studio 读取链路和端点常量。
- `apps/web/app/studio/actions.tsx`: `approveStudioWritebackAction` 批准写回 Server Action。
- `apps/web/components/scene-packet/ScenePacketPanel.tsx`: 既有 Scene Packet 面板。
- `apps/web/lib/api-client.ts`: Web 业务请求统一客户端。

### 4. 测试策略

- **测试框架**：`node:test` + `node:assert/strict`，由 `apps/web/scripts/phase1-contract-test.mjs` 执行。
- **测试模式**：源码级契约测试，不引入 React Testing Library 或新组件库。
- **参考文件**：`apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**：四步文案、Step 1/2/3/4 标签、当前/未完成状态类、`scrollIntoView` 自动滚动、无新增组件库。
### 5. 依赖和集成点

- **外部依赖**：Next.js 15.3.2、React 19.1.0、TypeScript 5.8.3。当前未安装 Tailwind；用户明确要求 Tailwind CSS，因此只允许引入 Tailwind CSS 构建能力，不引入组件库。
- **内部依赖**：Studio 页面依赖 `api.ts` 返回的 book/goal/packet/judge/repair/approval/recovery 状态。
- **集成方式**：Server Component 读取数据，Client Component 仅承载步骤条、区块包装和滚动副作用。
- **配置来源**：`apps/web/package.json`、`apps/web/app/globals.css`、根 `pnpm-lock.yaml`。

### 6. 技术选型理由

- **为什么用这个方案**：Next 官方文档要求使用 `useEffect`/ref/浏览器 API 时放入 Client Component；React 官方文档示例使用 ref 调用 `scrollIntoView`；Tailwind 官方文档支持 ring、border、opacity、disabled/gray 等状态工具类。
- **优势**：不破坏 `page.tsx` 薄入口和现有 API 读取链路；步骤状态可由已有服务端数据派生。
- **劣势和风险**：现有项目无 DOM 渲染测试工具，滚动行为只能通过源码契约和本地类型/构建验证补偿。

### 7. 关键风险点

- **并发问题**：无新增并发请求；滚动 effect 只依赖当前步骤索引。
- **边界条件**：作品为空时 Step 1 当前高亮，后续步骤置灰；已提交批准后 Step 4 完成。
- **性能瓶颈**：只新增轻量 Client Component 和一次滚动副作用。
- **安全考虑**：本任务不新增认证、鉴权或加密逻辑。
### 8. 上下文充分性检查

- 能说出至少 3 个相似实现：是，见 `page-content.tsx`、`retrieval/page.tsx`、`phase1-navigation.test.tsx`。
- 理解实现模式：是，Server Component 读取状态，Client Component 只处理交互。
- 知道可复用工具：是，复用 Studio API 读取函数、Server Action 和现有 Scene Packet 面板。
- 理解命名与风格：是，PascalCase 类型、camelCase 函数、中文文案、严格 TS。
- 知道如何测试：是，沿用 node:test 源码契约测试并运行 `pnpm --filter @storyforge/web test`。
- 确认不重复造轮子：是，已搜索 step/wizard/progress、Studio、Judge/批准，无项目内现成步骤条组件。
- 理解依赖和集成点：是，新增步骤流包装在 Studio 页面主体，不改变 API 请求顺序。

### 9. 外部资料来源与用途

- Context7 `/reactjs/react.dev`：确认 ref + `scrollIntoView` 的浏览器滚动模式。
- Context7 `/vercel/next.js`：确认使用 `useEffect` 和浏览器 API 需 Client Component 与 `"use client"`。
- Context7 `/tailwindlabs/tailwindcss.com`：确认 ring、border、opacity、disabled/gray 状态工具类。
- GitHub 搜索：本环境未暴露 `github.search_code` 工具；已记录并使用网页搜索与官方文档作为补偿。