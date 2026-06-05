## 项目上下文摘要（源码剪枝 Web artifacts redirect 页面壳）

生成时间：2026-06-05 17:30:30 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：对已下线旧页面新增 source-pruning 静态护栏，断言页面文件不存在，并验证主导航或运行时工具不重新接入旧入口。
  - 可复用：`existsSync` + `readFileSync` + 禁用路径文本断言。
  - 需注意：`/artifacts` 当前不是无入口孤儿页，URL 仍由 redirect 承接，不能照搬 `/assets` 的“导航也删除”策略。
- **实现2**: `apps/web/next.config.ts`
  - 模式：`storyforgeLegacyRedirects()` 将旧页面路由 308 到 IDE 壳层。
  - 可复用：`/artifacts` 已配置到 `/ide?panel.bottom=artifacts`，该 redirect 是删除 App Router 页面壳的承接点。
  - 需注意：删除 `app/artifacts/page.tsx` 时必须保留 redirect，否则 `/artifacts` 深链会断。
- **实现3**: `apps/web/components/home/HomeShell.tsx`
  - 模式：首页 `artifacts` 子视图复用 `ArtifactsPageContent`，不依赖 `app/artifacts/page.tsx`。
  - 可复用：`ArtifactsPageContent variant="home"` 是真实 Web 产物工作台内容。
  - 需注意：`page-content.tsx`、`api.ts`、`types.ts`、`validators.ts` 仍是生产链路，不是剪枝对象。
- **实现4**: `tests/e2e/phase4-contract.spec.ts`
  - 模式：阶段契约通过静态源码证据确认 Web 侧包含 Artifacts 工作台和后端 `/api/artifacts` 契约。
  - 可复用：可将证据从 `page.tsx + page-content.tsx` 收敛到 `page-content.tsx + api.ts`，继续证明真实工作台存在。
  - 需注意：测试不应继续把被 redirect 遮蔽的 App Router page 壳当作事实源。

### 2. 项目约定

- **命名约定**: Web 测试使用中文标题；组件导出使用 PascalCase；API helper 使用动词短语。
- **文件组织**: App Router 页面在 `apps/web/app/*/page.tsx`；可复用页面内容拆到 `page-content.tsx`；Web 剪枝护栏集中在 `apps/web/tests/source-pruning.test.ts`。
- **导入顺序**: Node 内置模块、第三方/框架、项目相对模块分组。
- **代码风格**: `node:test` + `assert` 静态源码验证；路径从 `process.cwd()` 拼接。

### 3. 可复用组件清单

- `apps/web/next.config.ts`: `storyforgeLegacyRedirects()` 提供 `/artifacts -> /ide?panel.bottom=artifacts` 308 redirect。
- `apps/web/app/artifacts/page-content.tsx`: `ArtifactsPageContent` 和 `ArtifactsWorkbench` 是保留的真实工作台内容。
- `apps/web/app/artifacts/api.ts`: `readArtifactWorkbenchData()` 通过 `readJson` 读取 `/api/artifacts` 列表、详情和下载摘要。
- `apps/web/app/artifacts/types.ts`: Artifacts 工作台类型定义。
- `apps/web/app/artifacts/validators.ts`: Artifacts API 响应校验。
- `apps/web/components/home/HomeShell.tsx`: 首页 artifacts 子视图复用 `ArtifactsPageContent`。
- `apps/web/components/ide/shell/EditorArea.tsx`: `legacy:artifacts` 仍指向 `/artifacts` 深链，由 redirect 承接。

### 4. 测试策略

- **测试框架**: Web 使用 Node test、React server render 静态测试和 Vitest/tsc lint 组合。
- **测试模式**: 本批先修改静态护栏并观察红灯，再删除页面壳和修正旧静态测试。
- **参考文件**:
  - `apps/web/tests/source-pruning.test.ts`
  - `apps/web/tests/phase1-navigation.test.tsx`
  - `apps/web/tests/phase8-stage4.test.tsx`
  - `tests/e2e/phase4-contract.spec.ts`
- **覆盖要求**:
  - 红灯：`app/artifacts/page.tsx` 存在时 source-pruning 失败。
  - 绿灯：页面壳删除后，`page-content.tsx`、`api.ts`、`types.ts`、`validators.ts`、redirect 和 `/api/artifacts` 契约仍被测试覆盖。

### 5. 依赖和集成点

- **外部依赖**: Next.js redirect 路由顺序；Context7 查询确认 redirects 在文件系统路由前处理。
- **内部依赖**:
  - `HomeShell` 直接导入 `../../app/artifacts/page-content`。
  - `EditorArea` 和 `site-nav-links` 仍保留 `/artifacts` 作为 legacy URL，实际由 redirect 进入 IDE artifacts 面板。
  - `packages/shared/src/generated/api-types.ts` 和后端 `/api/artifacts` 不是本批剪枝对象。
- **集成方式**: `/artifacts` URL 由 `storyforgeLegacyRedirects()` 承接；真实内容由首页和 IDE artifacts viewer 承接。
- **配置来源**: `apps/web/next.config.ts`。

### 6. 技术选型理由

- **为什么用这个方案**: `app/artifacts/page.tsx` 只有 `ArtifactsPageContent` 转发，且 `/artifacts` 已永久 redirect 到 IDE artifacts 面板；删除页面壳减少重复入口和被遮蔽代码。
- **优势**: URL 不断链，真实 Artifacts 工作台和 API 契约不受影响，测试从旧页面壳迁移到可复用内容和 redirect。
- **劣势和风险**: 阶段测试中存在直接读取 `app/artifacts/page.tsx` 的旧断言，必须同步改为读取 `page-content.tsx` 和 `api.ts`。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动；只涉及静态页面壳删除。
- **边界条件**: 不能删除 `app/artifacts/page-content.tsx`，否则首页 artifacts 子视图会断。
- **性能瓶颈**: 删除被 redirect 遮蔽页面壳不会增加 I/O；保留现有 API 读取。
- **安全考虑**: 不改 API client、认证 header、后端 `/api/artifacts` 或 OpenAPI 契约。
