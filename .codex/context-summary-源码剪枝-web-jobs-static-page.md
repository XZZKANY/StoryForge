## 项目上下文摘要（源码剪枝 Web jobs 静态页面）

生成时间：2026-06-05 14:52:22 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/app/jobs/page.tsx`
  - 模式：页面内维护硬编码 `jobs` 数组，`resumeHref` 指向 `/studio`、`/refinery`、`/assets`。
  - 可复用：无真实数据读取能力可复用。
  - 需注意：该页面未使用 `readJson`、`apiFetch`、`searchParams` 或真实 JobRun API。
- **实现2**: `apps/web/app/runs/page.tsx`
  - 模式：真实运行链路页面读取 JobRun 状态、runtime tools 和运行诊断摘要。
  - 可复用：真实运行入口应集中到 `/runs` 与 IDE runs 面板。
  - 需注意：本批不修改 `/runs` 页面。
- **实现3**: `apps/web/next.config.ts`
  - 模式：`storyforgeLegacyRedirects()` 将旧页面永久重定向到 IDE 壳层。
  - 可复用：新增 `/jobs` 到 `/ide?panel.bottom=runs`，与 `/runs` 重定向目标保持一致。
  - 需注意：Next 官方文档确认 redirects 使用 `source`、`destination`、`permanent`。
- **实现4**: `apps/web/tests/source-pruning.test.ts`
  - 模式：已下线页面或静态壳用文件存在性与导航残留护栏防止回归。
  - 可复用：`existsSync()`、`read()` 和字符串残留断言。
  - 需注意：红灯应命中页面存在和导航残留。

### 2. 项目约定

- **命名约定**: 页面组件使用 PascalCase，导航链接使用 `primaryNavLinks`，测试标题使用简体中文。
- **文件组织**: App Router 页面位于 `apps/web/app/*/page.tsx`，导航事实源位于 `components/site-nav/site-nav-links.ts`，重定向配置位于 `next.config.ts`。
- **导入顺序**: Node 内置模块、测试依赖、项目相对导入。
- **代码风格**: TypeScript 单引号、尾逗号、`readonly` 类型和简体中文断言说明。

### 3. 可复用组件清单

- `apps/web/app/runs/page.tsx`: 真实 JobRun 与运行诊断入口。
- `apps/web/next.config.ts`: legacy redirects 配置入口。
- `apps/web/tests/phase1-navigation.test.tsx`: 旧页面重定向契约测试。
- `apps/web/tests/site-nav.test.ts`: 主导航入口契约测试。
- `apps/web/tests/source-pruning.test.ts`: 源码剪枝护栏。

### 4. 测试策略

- **测试框架**: Node `node:test`，通过 `pnpm --filter @storyforge/web test -- ...` 运行。
- **测试模式**: 先新增 red 测试捕获 `/jobs` 页面存在、导航残留和 redirect 缺失，再删除页面并更新导航/redirect。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/site-nav.test.ts`、`apps/web/tests/phase1-navigation.test.tsx`。
- **覆盖要求**: 页面删除、导航移除、legacy redirect 存在、真实运行链路文件不被修改。

### 5. 依赖和集成点

- **外部依赖**: Next.js `redirects()` 配置。
- **内部依赖**: `primaryNavLinks` 被 `SiteNav` 与首页 Chrome 使用，`storyforgeLegacyRedirects()` 被测试直接导入。
- **集成方式**: `/jobs` 深链通过 permanent redirect 进入 `/ide?panel.bottom=runs`。
- **配置来源**: `apps/web/next.config.ts`。

### 6. 技术选型理由

- **为什么用这个方案**: 直接删除 `/jobs` 页面会让深链失效；加入 legacy redirect 可把旧入口收敛到真实 Runs 面板。
- **优势**: 减少硬编码任务中心壳，同时保留用户旧链接可达真实运行状态入口。
- **劣势和风险**: API jobs 模型仍存在，本批不处理后端 JobRun 存储模型；它仍被 analytics、quality、model_runs 等后端链路使用。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: `/jobs` 不再作为主导航入口，但旧 URL 仍可重定向。
- **性能瓶颈**: 删除静态页面不增加网络请求。
- **安全考虑**: 不改 API 权限、JobRun 模型或 model_runs 路由。
