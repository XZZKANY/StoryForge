## 项目上下文摘要（源码剪枝 Web assets 孤儿静态页）

生成时间：2026-06-05 16:38:21 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：通过 `existsSync` 和导航源码断言防止已下线静态页回潮。
  - 可复用：`root`、`read()`、`join(root, ...)` 和静态页路径护栏。
  - 需注意：本批只处理 Web 页面，不处理 `/api/assets` 后端契约。
- **实现2**: `test('Web 静态 jobs 页面不应继续作为任务中心主入口保留', ...)`
  - 模式：删除无真实入口的静态页，同时确认导航不重新接入旧路由。
  - 可复用：页面存在性 + `primaryNavLinks` 路由断言。
  - 需注意：不新增 redirect，除非已有深链需要承接。
- **实现3**: `test('Web 静态 refinery 演示页不应继续作为批量精修主入口保留', ...)`
  - 模式：下线硬编码演示页，让真实链路由其他工作台承接。
  - 可复用：硬编码页面下线的护栏表达。
  - 需注意：本批保留 `app/artifacts` 产物链路和 API assets。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase，测试标题使用简体中文说明业务边界。
- **文件组织**: Next App Router 页面位于 `apps/web/app/*/page.tsx`，Web 剪枝护栏集中在 `apps/web/tests/source-pruning.test.ts`。
- **导入顺序**: node 内置模块导入在前，测试 helper 常量在后。
- **代码风格**: `node:test` + `assert.ok`，断言消息使用简体中文。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: Web 静态页面和未接入模块的防回潮护栏。
- `apps/web/components/site-nav/site-nav-links.ts`: 主导航事实源。
- `apps/api/app/domains/assets/router.py`: 后端 `/api/assets` 真实契约，必须保留。
- `packages/shared/src/contracts/storyforge.openapi.json`: `/api/assets` OpenAPI 契约，必须保留。
- `apps/web/app/artifacts/*`: 产物链路，不属于本批删除范围。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`，经 `pnpm --filter @storyforge/web test -- ...` 调用。
- **测试模式**: 先新增 `source-pruning` 红灯，确认 `app/assets/page.tsx` 仍存在导致失败；再删除页面形成绿灯。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/site-nav.test.ts`。
- **覆盖要求**: Web `/assets` 页面下线、导航不接 `/assets`、后端 `/api/assets` 契约保留、Web 全量和 lint 不退化。

### 5. 依赖和集成点

- **外部依赖**: 无新增依赖。
- **内部依赖**: Web 静态页没有生产导入；后端 assets API 由 API/OpenAPI/shared/E2E 合同覆盖。
- **集成方式**: 删除孤儿页面，不新增替代入口。
- **配置来源**: `next.config.ts` 当前没有 `/assets` redirect，本批不新增。

### 6. 技术选型理由

- **为什么用这个方案**: `app/assets/page.tsx` 只维护硬编码素材数组，没有导航或真实 API 读取链路；保留会让前端资产入口与后端 `/api/assets` 真实契约分叉。
- **优势**: 减少孤儿路由和硬编码演示数据，降低维护面。
- **劣势和风险**: 直接访问 `/assets` 将不再有页面；当前没有入口或 redirect 需求。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不修改 `/api/assets`、OpenAPI、shared generated types 或 `app/artifacts`。
- **性能瓶颈**: 删除孤儿页面减少构建路由，影响正向。
- **安全考虑**: 本批不修改认证、鉴权、限流、请求超时或安全响应头。
