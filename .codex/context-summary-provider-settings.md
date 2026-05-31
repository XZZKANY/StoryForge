## 项目上下文摘要（设置页 Provider 模型检测）

### 1. 相似实现分析

- `apps/web/app/providers/page.tsx`：现有 Provider 页面是静态入口，适合作为设置页文案参照。
- `apps/web/components/site-nav/site-nav-links.ts`：全局导航通过 `primaryNavLinks` 统一声明。
- `apps/web/components/home/home-data.ts`：首页业务入口集中在数据文件。
- `apps/web/lib/api-client.ts`：现有 StoryForge 后端 API client 提供 URL 和错误处理模式参照。

### 2. 项目约定

- Next.js App Router，页面位于 `apps/web/app/<route>/page.tsx`。
- 客户端交互组件使用 `'use client'`。
- 测试采用 Node `node:test`。

### 3. 测试策略

- 新增 `apps/web/tests/settings-page.test.ts`，覆盖设置页、模型检测 API、导航接入和核心提取逻辑。

### 4. 工具缺口记录

当前会话未提供 `sequential-thinking`、`shrimp-task-manager`、`desktop-commander`、`context7`、`github.search_code` 工具；已使用本地 PowerShell 和 Python 文件检索替代并记录。
