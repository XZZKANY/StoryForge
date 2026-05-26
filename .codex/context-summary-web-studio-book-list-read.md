## 项目上下文摘要（Web Studio 作品列表读取）

生成时间：2026-05-19 10:05:00 +08:00

### 1. 相似实现分析

- `apps/web/app/studio/page.tsx`：当前 Studio 页面是 Next.js App Router Server Component，已从 `phase6DataSources.studio` 渲染数据源契约，并展示 `phase6FirstDataSourceSpike` 的读取输入、读取输出和失败态，但没有读取 `/api/studio/books`。
- `apps/web/app/retrieval/page.tsx`：同样从 `phase6DataSources.retrieval` 渲染数据源契约，证明 Phase 6 页面当前统一采用 registry 驱动的静态契约模式。
- `apps/web/app/runs/page.tsx`：从 `phase6DataSources.runs` 渲染数据源契约，页面结构与 Studio/Retrieval 保持一致：标题、说明、能力列表、数据源契约。
### 2. 项目约定

- Web 使用 Next.js App Router、React 19、TypeScript strict、`pnpm --filter @storyforge/web test` 的源码契约测试。
- 页面文件采用默认导出函数组件，中文页面文案直接写入 JSX，契约测试通过源码文本断言保护。
- Phase 6 数据源契约集中在 `apps/web/lib/phase6-data-sources.ts`，当前只允许选择 `phase6FirstDataSourceSpike` 做单页面单数据源真实读取。

### 3. 可复用组件清单

- `phase6FirstDataSourceSpike`：首个真实读取起点，固定为 Studio 的作品列表 API。
- `phase6DataSources.studio`：Studio 数据源契约列表，继续作为页面契约渲染来源。
- `assertIncludesAll()`：前端契约测试的既有断言工具。
### 4. 测试策略

- 参考 `apps/web/tests/phase1-navigation.test.tsx`：使用 Node `node:test`、`assert`、源码读取与关键中文/标识符断言。
- 第1轮先补红灯断言，要求 Studio 页面出现 `/api/studio/books`、`读取作品列表`、`空列表`、`可重试错误摘要` 等单点读取边界。
- 后续第2轮实现后继续运行 Web 契约测试、TypeScript、API Studio 单测和 API compileall。

### 5. 依赖和集成点

- API 端已实现 `GET /api/studio/books`，返回 `id:int`、`title:str`、`recent_chapter_ordinal:int | None`，支持 `workspace_id:int`。
- Web 端当前没有 `fetch(` 使用记录，因此不得引入全局 client；优先采用页面级或 Studio 范围内最小读取封装。
- Next.js 官方文档建议 App Router Server Component 可用 `async` 页面和 `fetch(..., { cache: 'no-store' })` 做动态读取，并在响应失败时渲染错误信息。
### 6. 技术选型理由

- 选择 Next.js Server Component 内部最小读取，是因为现有页面均为 Server Component，项目尚无前端 API client 模式。
- 选择源码契约测试，是因为现有 Web 验证已经以中文契约和关键标识符断言为主，能低成本保护边界。
- 不新增全量 client、缓存平台或状态管理，避免扩大 Phase 6 单点 spike 范围。

### 7. 关键风险点

- API base URL 需要可配置默认值，不能假设生产域名；本轮可采用本地默认 `http://127.0.0.1:8000` 并允许环境变量覆盖。
- 页面必须保留失败态和空列表态，否则 API 不可用时会破坏 Studio 入口。
- 章节目标、Scene Packet、Judge、Repair 和批准回写仍未联通，文档必须继续区分状态。
