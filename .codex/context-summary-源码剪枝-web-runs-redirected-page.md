## 项目上下文摘要（源码剪枝 Web runs redirect 页面壳）

生成时间：2026-06-05 18:21:32 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：使用 `existsSync` 和源码字符串断言锁定已下线 Web 壳文件不得回潮，同时保留真实链路。
  - 可复用：`Web artifacts redirect 页面壳不应继续保留` 护栏模式。
  - 需注意：`/runs` 旧页比 `/artifacts/page.tsx` 更厚，删除前必须迁移 Phase4/Phase5 合同证据。
- **实现2**: `apps/web/next.config.ts`
  - 模式：`storyforgeLegacyRedirects()` 统一声明旧页面 permanent redirect。
  - 可复用：`{ source: '/runs', destination: '/ide?panel.bottom=runs', permanent: true }` 已存在。
  - 需注意：不修改 `/jobs` 与 `/runs` redirect，旧深链仍应进入 IDE runs 面板。
- **实现3**: `apps/web/components/ide/shell/BottomPanel.tsx`
  - 模式：`activePanel === 'runs'` 时渲染 `BookRunEventsPanel`。
  - 可复用：IDE runs 面板是真实运行入口。
  - 需注意：该面板是 BookRun + SSE 视角，不是旧 `/runs/page.tsx` 的 ModelRun runtime diagnostics 页面一比一替代。
- **实现4**: `tests/e2e/phase5-runtime-diagnostics.spec.ts`
  - 模式：通过 OpenAPI schema、API 真实响应和源码证据证明 runtime diagnostics 链路。
  - 可复用：保留 OpenAPI/API 证据，替代旧 page 源码证据。
  - 需注意：不能继续读取删除后的 `apps/web/app/runs/page.tsx`。

### 2. 项目约定

- **命名约定**: Web 测试使用 `node:test`、`assert.ok` 和简体中文测试标题。
- **文件组织**: App Router 页面在 `apps/web/app/*/page.tsx`；IDE 真入口在 `apps/web/app/ide/page.tsx` 与 `apps/web/components/ide/*`。
- **导入顺序**: 现有测试多为 Node 内置模块、React/组件、项目模块。
- **代码风格**: TypeScript 使用单引号、分号和源码字符串证据；剪枝护栏集中在 `source-pruning.test.ts`。

### 3. 可复用组件清单

- `apps/web/next.config.ts`: `storyforgeLegacyRedirects()` 已保留 `/runs -> /ide?panel.bottom=runs`。
- `apps/web/components/ide/views/BookRunPanel.tsx`: IDE runs 面板的 BookRun 状态、checkpoint、命令按钮。
- `apps/web/components/ide/views/BookRunEventsPanel.tsx`: IDE runs 面板 SSE 快照事件入口。
- `apps/web/app/ide/page.tsx`: `panel.bottom=runs` 且有 `book_run` query 时读取 `/api/book-runs/{id}` 和 `/api/ide/runs/{id}/events`。
- `apps/api/app/domains/model_runs/service.py`: 保留 `/api/model-runs/job-runs/{job_run_id}` runtime diagnostics 读侧。
- `packages/shared/src/contracts/storyforge.openapi.json`: 保留 RuntimeTool 与 RunsJobRunRead schema 契约。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test` 经 `pnpm --filter @storyforge/web test` 运行；合同通过 `node scripts/run-e2e.mjs` 运行。
- **红灯护栏**: 在 `apps/web/tests/source-pruning.test.ts` 新增 `/runs` page 壳不得存在的测试，同时断言 `/runs` redirect、`BookRunPanel`、`BookRunEventsPanel`、`/api/book-runs/`、`/api/ide/runs/` 与 runtime diagnostics API/OpenAPI 契约仍存在。
- **迁移测试**:
  - `apps/web/tests/phase1-navigation.test.tsx` 不再把 `app/runs/page.tsx` 纳入文本编码和 API client 页面断言，改为验证 `/runs` redirect、IDE runs 面板和 API/OpenAPI 读侧。
  - `apps/web/tests/phase8-stage4.test.tsx` 的 runs 页面断言迁移到 `BookRunEventsPanel` 或 `BookRunPanel`。
  - `tests/e2e/phase4-contract.spec.ts` 不再读取旧 page，改为验证 `EditorArea` legacy URL、IDE runs 面板和 runtime tools API 契约。
  - `tests/e2e/phase5-runtime-diagnostics.spec.ts` 不再读取旧 page，保留 OpenAPI/API runtime diagnostics 证据，并用 IDE runs 面板源码证明当前 UI 入口。
- **覆盖要求**: 红灯、定向 Web 测试、Phase4/Phase5 合同、Web 全量、lint、残留搜索和 diff check。

### 5. 依赖和集成点

- **外部依赖**: Next.js `redirects()` 官方配置；Context7 查询 `/vercel/next.js` 确认 `source`、`destination`、`permanent` 写法。
- **内部依赖**:
  - `/runs` 旧 URL 由 `storyforgeLegacyRedirects()` 进入 `/ide?panel.bottom=runs`。
  - IDE runs 面板依赖 `BookRunPanel`、`BookRunEventsPanel`、`BottomPanel`、`app/ide/page.tsx`。
  - runtime diagnostics API 依赖 `model_runs` 后端和 OpenAPI/generated types。
- **集成方式**: Next redirect 承接旧页面路径，IDE URL state 使用 `panel.bottom=runs`。
- **配置来源**: `apps/web/next.config.ts`。

### 6. 技术选型理由

- **为什么用这个方案**: 旧 `/runs/page.tsx` 被永久 redirect 遮蔽，真实入口已收敛到 IDE runs 面板；删除遮蔽 page 可减少重复页面职责。
- **优势**: 消除一个厚旧页面源码事实源，防止合同继续绑定被遮蔽 UI。
- **劣势和风险**: 旧 page 曾承载 ModelRun runtime diagnostics UI，IDE runs 面板当前是 BookRun/SSE 视角；删除时必须把 runtime diagnostics 证明留在 API/OpenAPI 层，避免误判“UI 已完整迁移”。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动，本批是页面壳删除和测试迁移。
- **边界条件**: `/runs` redirect 必须保留；`/api/model-runs/job-runs/{job_run_id}`、`/api/runtime-tools`、`BookRunPanel`、`BookRunEventsPanel` 不得删除。
- **性能瓶颈**: 删除旧 page 减少构建页面面；不新增运行时请求。
- **安全考虑**: 不修改 API key 注入、CSP、安全 headers 或 API 鉴权。

### 8. 充分性检查

- □ 我能定义清晰的接口契约吗？是：旧 URL `/runs` 继续 redirect 到 `/ide?panel.bottom=runs`；runtime diagnostics 仍由 API/OpenAPI 验证。
- □ 我理解关键技术选型的理由吗？是：Next redirects 遮蔽 page 文件，仓库已采用旧页面 redirect 到 IDE 的迁移策略。
- □ 我识别了主要风险点吗？是：旧 page 的 ModelRun UI 证据不能简单丢失，必须迁到 API/OpenAPI 和 IDE runs 面板事实源。
- □ 我知道如何验证实现吗？是：运行 source-pruning、phase1-navigation、phase8-stage4、ide-components、ide-page、Phase4/Phase5 e2e、Web 全量、lint、残留搜索和 diff check。
