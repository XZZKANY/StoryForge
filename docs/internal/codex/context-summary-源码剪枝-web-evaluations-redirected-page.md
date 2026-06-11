## 项目上下文摘要（源码剪枝 Web evaluations redirected page）

生成时间：2026-06-05 19:14:45 +08:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：对被 legacy redirect 遮蔽的旧页面使用 `existsSync` 断言不再存在，并同时保护 redirect 与真实入口。
  - 可复用：`Web artifacts redirect 页面壳不应继续保留`、`Web runs redirect 页面壳不应继续保留` 两个护栏。
  - 需注意：护栏不能只删页面，还必须证明 API/OpenAPI 或 IDE 面板入口仍存在。
- **实现2**: `apps/web/next.config.ts`
  - 模式：`storyforgeLegacyRedirects()` 统一声明旧页面永久重定向。
  - 可复用：`/evaluations -> /ide?panel.bottom=evaluation` 已与 `/runs`、`/artifacts` 同类。
  - 需注意：删除 `app/evaluations/page.tsx` 后，旧深链必须继续由 redirect 承接。
- **实现3**: `apps/web/components/ide/shell/EditorArea.tsx`
  - 模式：`legacyLabels` 保留 `legacy:evaluations` 元数据，作为 IDE 内旧入口提示。
  - 可复用：`title: 'Evaluations 评测系统'`、`href: '/evaluations'`、`summary: '评测诊断入口已在 IDE 内访问。'`。
  - 需注意：这里不是旧页面完整 UI，不能迁移旧页面的 readJson 和趋势守卫断言。
- **实现4**: `apps/web/components/ide/shell/BottomPanel.tsx` 与 `apps/web/components/ide/url/ide-url-state.ts`
  - 模式：IDE 底部面板和 URL 状态均识别 `evaluation`。
  - 可复用：`activePanel === 'evaluation'` 的通用底部面板展示与 URL 解析。
  - 需注意：当前 evaluation 面板是 IDE 槽位入口，不是独立评测详情页面。
- **实现5**: `tests/e2e/phase4-contract.spec.ts`
  - 模式：Phase4 合同聚合 Web 入口、API 测试和 OpenAPI 事实源。
  - 可复用：将 evaluations Web 事实源从旧 page 迁移到 `EditorArea`、`BottomPanel`、`ide-url-state`、`next.config.ts`、OpenAPI 和 API 测试。
  - 需注意：评测业务契约仍由 `/api/evaluations/*` 和 `Evaluation*` schemas 承担。

### 2. 项目约定

- **命名约定**: 测试函数使用中文业务说明，源码护栏使用 `test('...')`。
- **文件组织**: Web 旧页面路由由 `next.config.ts` redirect 接管；IDE 入口在 `components/ide` 与 `app/ide/page.tsx`。
- **导入顺序**: Node 内置模块优先；测试文件保持既有 `assert`、`fs`、`path`、`node:test` 模式。
- **代码风格**: 使用源码字符串断言与本地文件读取，不新增测试框架或运行脚本。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 源码剪枝护栏。
- `apps/web/tests/phase1-navigation.test.tsx`: redirect、API client 与文本编码等合同测试。
- `apps/web/tests/phase8-stage4.test.tsx`: Web 页面与 IDE 面板源码合同测试。
- `tests/e2e/phase4-contract.spec.ts`: Phase4 API/OpenAPI/Web 入口合同。
- `apps/web/next.config.ts`: `/evaluations` legacy redirect 事实源。
- `apps/web/components/ide/shell/EditorArea.tsx`: legacy evaluations IDE 元数据。
- `apps/web/components/ide/shell/BottomPanel.tsx`: `evaluation` 底部面板槽位。
- `apps/web/components/ide/url/ide-url-state.ts`: `evaluation` URL 状态类型。
- `packages/shared/src/contracts/storyforge.openapi.json`: `/api/evaluations/*` 与 `Evaluation*` schema 事实源。
- `apps/workflow/storyforge_workflow/tools/registry.py`: runtime tools references 事实源，需要移除旧 page 路径。

### 4. 测试策略

- **测试框架**: Web 使用 `node:test`，根命令为 `pnpm --filter @storyforge/web test`；TypeScript 检查为 `pnpm --filter @storyforge/web lint`。
- **测试模式**: 先扩展 `source-pruning.test.ts` 观察旧 page 仍存在导致红灯，再删除旧 page 并迁移相关源码合同。
- **参考文件**: `apps/web/tests/source-pruning.test.ts` 中 artifacts/runs redirect 页面壳护栏。
- **覆盖要求**: 正常路径覆盖 redirect、IDE evaluation 入口、OpenAPI/API 评测契约；边界覆盖旧 page 不存在、registry 不再引用旧 page、测试不再读取旧 page。

### 5. 依赖和集成点

- **外部依赖**: Next.js redirect 由 `next.config.ts` 提供，本批不引入新依赖。
- **内部依赖**: `site-nav` 和 `EditorArea` 保留 `/evaluations` legacy href；`BottomPanel` 和 URL state 保留 `evaluation` 面板槽位；API/OpenAPI 保留 `/api/evaluations/*`。
- **集成方式**: 旧 URL 由 308 redirect 进入 `/ide?panel.bottom=evaluation`；评测业务数据由 API/OpenAPI 与后端测试证明。
- **配置来源**: `apps/web/next.config.ts`。

### 6. 技术选型理由

- **为什么用这个方案**: `/evaluations` 已被永久 redirect 遮蔽，旧 `app/evaluations/page.tsx` 的独立读取逻辑不会成为真实旧深链入口；与已完成 `/artifacts`、`/runs` 剪枝模式一致。
- **优势**: 减少重复 Web 页面职责，保留旧 URL、IDE 入口和 API 评测契约。
- **劣势和风险**: IDE evaluation 面板当前不是旧页面完整评测详情 UI；删除旧 page 会移除独立评测摘要页面。该风险由 redirect 与 API/OpenAPI 契约留痕。

### 7. 关键风险点

- **并发问题**: 无运行时并发改动。
- **边界条件**: 不得删除 `/api/evaluations/cases`、`/api/evaluations/runs`、`/api/evaluations/runs/{run_id}`、`/api/evaluations/runs/{run_id}/failed-samples` 契约。
- **性能瓶颈**: 删除旧页面减少服务端读取路径，不新增 I/O。
- **安全考虑**: 不修改 API client、安全头、认证或后端评测路由。

### 8. 充分性检查

- 能定义清晰接口契约：是，本批接口是旧 page 文件不存在，redirect 和 IDE/API 事实源保留。
- 理解技术选型理由：是，与 `/artifacts`、`/runs` redirect 页面壳剪枝一致。
- 识别主要风险点：是，旧独立 UI 删除但 API/OpenAPI 与 IDE legacy 入口保留。
- 知道如何验证：是，红灯 source-pruning、定向 Web 测试、Phase4 合同、Web 全量、lint、残留/保留搜索、diff check。
