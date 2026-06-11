## 项目上下文摘要（源码剪枝 Web refinery 静态演示页）

生成时间：2026-06-05 15:07:44 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/next.config.ts`
  - 模式：旧页面通过 `storyforgeLegacyRedirects()` 返回 Next.js redirect 对象进入 IDE 壳层。
  - 可复用：`source`、`destination`、`permanent: true` 数组对象结构。
  - 需注意：`/studio` 已进入 `legacy:studio` tab，适合作为 `/refinery` 的真实 Studio 链路目标。
- **实现2**: `apps/web/tests/source-pruning.test.ts`
  - 模式：通过 `existsSync` 与源码字符串断言防止已下线页面或模块回归。
  - 可复用：页面存在性护栏、导航入口残留护栏。
  - 需注意：护栏只描述剪枝边界，不应替代真实功能测试。
- **实现3**: `apps/web/tests/phase1-navigation.test.tsx`
  - 模式：直接导入 `storyforgeLegacyRedirects()`，用 `deepEqual` 固定旧页面重定向契约。
  - 可复用：新增 `/refinery` redirect 期望，并同步更新 redirect 数量。
  - 需注意：测试应继续验证 `permanent: true` 对应 Next HTTP 308。
- **实现4**: `tests/e2e/phase2-contract.spec.ts`
  - 模式：使用源码合同验证 Phase 2 后端端点、测试证据和前端入口边界。
  - 可复用：将旧 `/refinery` 静态页证据替换为真实 Studio 页面和 API endpoint 证据。
  - 需注意：不再读取将被删除的 `apps/web/app/refinery/page.tsx`。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase 函数和常量；页面组件使用 PascalCase；测试标题使用简体中文。
- **文件组织**: Web 页面位于 `apps/web/app`，主导航集中在 `components/site-nav/site-nav-links.ts`，旧入口重定向集中在 `next.config.ts`。
- **导入顺序**: Node 测试优先导入 `node:*` 模块，再导入项目模块。
- **代码风格**: 单引号、尾逗号、`node:test` + `assert`、中文断言说明。

### 3. 可复用组件清单

- `apps/web/next.config.ts`: `storyforgeLegacyRedirects()` 旧入口重定向事实源。
- `apps/web/app/studio/page-content.tsx`: 真实 Judge/Repair/Approve 前端链路。
- `apps/web/app/studio/api.ts`: `studioJudgeReviewsEndpoint`、`studioRepairPatchesEndpoint`、`studioApprovalSummaryEndpoint`。
- `apps/web/tests/source-pruning.test.ts`: 剪枝回归护栏。
- `apps/web/tests/site-nav.test.ts`: 主导航契约护栏。
- `apps/web/tests/phase1-navigation.test.tsx`: legacy redirect 契约护栏。
- `tests/e2e/phase2-contract.spec.ts`: Phase 2 源码合同。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`；Web 包测试通过 `pnpm --filter @storyforge/web test` 运行；根目录 Phase2 合同使用 `node --test`。
- **测试模式**: 先修改护栏并运行红灯，再删除页面、移除导航并新增 redirect 后运行绿灯。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/site-nav.test.ts`、`apps/web/tests/phase1-navigation.test.tsx`、`tests/e2e/phase2-contract.spec.ts`。
- **覆盖要求**: 页面不存在、主导航不包含 `/refinery`、旧深链通过 redirect 进入真实 Studio IDE tab、Phase2 前端证据来自 Studio 真实 endpoint。

### 5. 依赖和集成点

- **外部依赖**: Next.js `redirects()` 配置，Context7 官方文档确认 `source`、`destination`、`permanent` 是有效形态。
- **内部依赖**: `primaryNavLinks` 控制主导航；`storyforgeLegacyRedirects()` 控制旧页面深链；Studio 通过 `readStudioJudgeReview`、`readStudioRepairPatches`、`readStudioApprovalSummary` 读取真实 API。
- **集成方式**: 删除静态页面入口，保留 `/refinery` URL 通过 308 redirect 进入 `/ide?tab=legacy%3Astudio&active=legacy%3Astudio`。
- **配置来源**: `apps/web/next.config.ts`。

### 6. 技术选型理由

- **为什么用这个方案**: `/refinery` 页面只维护硬编码文本、空评审问题和静态差异展示；真实评审修复链路已在 Studio 与 IDE 中存在。
- **优势**: 减少静态演示壳和主导航噪声，避免用户进入未联通页面，同时保留旧 URL 可达性。
- **劣势和风险**: `/refinery` 不再作为独立页面存在；若后续需要批量精修专页，应基于真实 batch-refinery run 数据重新建设。

### 7. 关键风险点

- **并发问题**: 本批只修改 Web 路由/测试，不涉及并发运行时。
- **边界条件**: Phase2 合同不得继续读取待删除页面，否则删除后会产生文件缺失失败。
- **性能瓶颈**: 删除动态导入演示页可减少无效页面维护面。
- **安全考虑**: 不修改 CSP、安全头、API Key 注入、鉴权或后端批量精修 API。
