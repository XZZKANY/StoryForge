
## 项目上下文摘要（首页主工作台功能嵌入）

生成时间：2026-06-01 22:59:36 +08:00

### 1. 相似实现分析

- pps/web/app/blueprints/page.tsx：薄页面读取 searchParams 后渲染 Blueprint 工作台，适合抽成可复用容器。
- pps/web/app/studio/page.tsx 与 pps/web/app/studio/page-content.tsx：页面入口薄，核心流程在内容组件内；嵌入首页时需要解除 /studio 链接和批准回跳硬编码。
- pps/web/app/artifacts/page.tsx：原本类型、读取、校验和渲染混在页面内，适合拆成 	ypes/api/validators/page-content。
- pps/web/app/settings/SettingsClient.tsx：已有客户端 localStorage 模式，Provider 设置可拆出后与创作偏好保持边界。

### 2. 项目约定

- 使用 Next.js App Router，页面组件接收并 await searchParams Promise。
- 本地测试使用 
ode:test 与 pps/web/scripts/phase1-contract-test.mjs 静态/轻量渲染契约。
- UI 采用 Tailwind 类和深色 StoryForge Assistant 桌面布局，移动端本轮不专项调整。

### 3. 可复用组件清单

- BlueprintWorkbench、eadBlueprint、eadBookRun：复用到首页 
ew-project。
- StudioFlow、ScenePacketPanel、JudgeIssueList、RepairDiffViewer 与 Studio API 读取函数：复用到首页 projects。
- ArtifactsPageContent、ArtifactsWorkbench：供首页 rtifacts 与旧页面源码复用。
- ProviderSettingsPanel 与 CreativePreferencesPanel：设置页拆分后，首页 customize 只复用创作偏好。

### 4. 测试策略

- 目标契约：pnpm --filter @storyforge/web test -- home-page blueprints studio settings-page phase8-stage4 phase1-navigation。
- 类型验证：pnpm --filter @storyforge/web lint。
- 本地服务冒烟：访问 /?view=assistant|new-project|projects|artifacts|customize 均返回 200。

### 5. 依赖和集成点

- 数据读取统一使用 pps/web/lib/api-client.ts 的 eadJson/piFetch。
- Studio 批准写回仍走 pproveStudioWritebackAction，新增 result target 保留首页 projects 回跳。
- Blueprint 操作通过 createBlueprintWorkflowAction 触发 create/lock/chapter-plan/book-run。
- 创作偏好只写浏览器 storyforge-creative-preferences，不混入 Provider/API Key。

### 6. 技术选型理由

- 使用 ?view= 而不是新路由，匹配用户要求“左侧点击后中间整块内容切换”。
- 旧页面源码尽量复用同一组件，不删除旧路由和 legacy redirect，降低兼容风险。
- 每个子页按当前 active view 才读取数据，避免首页默认加载所有旧页 API。

### 7. 关键风险点

- 当前没有浏览器截图工具可用，本轮用 HTTP 200 与 lint/test 代替浏览器 console 验证。
- Blueprint 创建默认 ook_id=1，若本地数据没有对应作品会返回可见错误；后续可接入作品选择。
- /studio、/artifacts 仍有 legacy redirect 配置，源码页面保留用于复用和兼容。
