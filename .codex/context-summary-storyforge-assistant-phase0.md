## 项目上下文摘要（StoryForge Assistant Phase 0）

生成时间：2026-06-09 00:00:00

### 1. 相似实现分析

- **实现1**: `apps/web/components/home/assistant-session-store.ts`
  - 模式：通过统一 `readJson` API client 读取 `/api/assistant/sessions`，再映射为首页最近记录。
  - 可复用：`readRecentAssistantSessions`、`mapAssistantSessionToHomeRecentItem`。
  - 需注意：返回的是 `HomeRecentItem`，需要转换为侧栏 `RecentItem`。
- **实现2**: `apps/web/components/site-nav/RecentItemsList.tsx`
  - 模式：客户端组件通过 `useSyncExternalStore` 订阅 `recent-items-store`。
  - 可复用：现有 localStorage 记录读取与空状态展示。
  - 需注意：当前只读 localStorage，是架构文档指出的断点。
- **实现3**: `apps/web/components/site-nav/UnifiedSidebar.tsx`
  - 模式：客户端侧栏负责路径高亮、折叠最近记录、账号菜单和主题切换。
  - 可复用：最近记录折叠区和 `RecentItemsList` 装配点。
  - 需注意：作为 client component 不能直接 await 后端会话读取。
- **实现4**: `apps/web/components/site-nav/Chrome.tsx`
  - 模式：全站壳层装配 `UnifiedSidebar` 和右侧主区域。
  - 可复用：全站唯一侧栏入口。
  - 需注意：当前是 client component，可拆为 server wrapper + client shell。
- **实现5**: `apps/web/components/home/HomeShell.tsx`
  - 模式：服务端组件读取项目数据后传给客户端面板。
  - 可复用：服务端取数再传可序列化 props 的模式。
  - 需注意：与 Next.js 官方 Server Component 向 Client Component 传数据模式一致。

### 2. 项目约定

- **命名约定**: React 组件使用 PascalCase，工具函数使用 camelCase，类型使用 PascalCase。
- **文件组织**: 前端功能按 `components/home`、`components/site-nav`、`app/*` 分组。
- **导入顺序**: Node/第三方依赖在前，本地模块在后，类型与值混合时沿用现有写法。
- **代码风格**: TypeScript strict、只读 props、Tailwind 类名沿用现有深色侧栏样式。

### 3. 可复用组件清单

- `apps/web/components/home/assistant-session-store.ts`: 读取并映射 Assistant 最近会话。
- `apps/web/components/site-nav/recent-items-store.ts`: localStorage 最近记录与订阅机制。
- `apps/web/components/site-nav/RecentItemsList.tsx`: 最近记录渲染组件。
- `apps/web/components/site-nav/UnifiedSidebar.tsx`: 统一侧栏容器。
### 4. 测试策略

- **测试框架**: Web 使用 Node 内置 `node:test`，入口为 `pnpm --filter @storyforge/web test`。
- **参考文件**: `apps/web/tests/home-page.test.tsx`、`apps/web/tests/assistant-session-store.test.ts`。
- **覆盖要求**: 静态契约测试先锁定文件依赖和关键字符串，再运行 Web 测试；必要时运行 `pnpm --filter @storyforge/web lint`。

### 5. 依赖和集成点

- **外部依赖**: Next.js 15、React 19、lucide-react。
- **内部依赖**: `Chrome` 装配 `UnifiedSidebar`；`UnifiedSidebar` 装配 `RecentItemsList`；`assistant-session-store` 读取 `/api/assistant/sessions`。
- **集成方式**: 服务端组件读取真实最近会话，传入客户端侧栏；客户端侧栏继续合并 localStorage 补充记录。
- **配置来源**: `apps/web/lib/api-client.ts` 负责 API base URL 和本地开发 key。

### 6. 技术选型理由

- **为什么用服务端读取**: Next.js 官方建议在 Server Component 获取数据并把可序列化 props 传给 Client Component。
- **优势**: 刷新后也能看到真实 Assistant 最近会话，并保留客户端本地补充记录。
- **劣势和风险**: layout 级读取可能让所有页面触发一次最近会话查询；当前 limit 应保持较小。

### 7. 关键风险点

- **边界条件**: API 失败时不能阻断全站布局，应回退为空真实记录和 localStorage 补充记录。
- **性能瓶颈**: 全站 layout 读取最近会话，limit 固定为较小值。
- **安全考虑**: 只传标题、摘要、href、类型和状态，不传 Provider 凭据或完整消息内容。
