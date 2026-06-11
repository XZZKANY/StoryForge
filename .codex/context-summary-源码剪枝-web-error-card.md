## 项目上下文摘要（源码剪枝 web-error-card）

生成时间：2026-06-05 13:53:00

### 1. 相似实现分析

- **实现1**: `apps/web/tests/source-pruning.test.ts`
  - 模式：使用 `existsSync` 检查已下线文件不得回归，并用 forbidden 字符串清单检查转译脚本残留。
  - 可复用：`root`、`read()`、`join(root, ...)`。
  - 需注意：source-pruning 护栏自身允许保留已下线符号文本，残留搜索需排除该文件。
- **实现2**: `apps/web/components/ui/LoadingSkeleton.tsx` 与 `apps/web/tests/ui-components.test.tsx`
  - 模式：共享 UI 组件通过 React 服务端静态渲染做轻量组件契约测试。
  - 可复用：`renderToStaticMarkup(React.createElement(...))`。
  - 需注意：`LoadingSkeleton` 被 `apps/web/app/loading.tsx` 生产导入，不能纳入本批剪枝。
- **实现3**: `apps/web/scripts/phase1-contract-test.mjs`
  - 模式：通过 `runtimeModules` 和 `importRewrites` 为 Node 测试转译 Web TS/TSX 模块。
  - 可复用：精确移除目标模块的 runtime module 与 import rewrite 条目。
  - 需注意：只移除 ErrorCard 相关条目，保留 LoadingSkeleton 和其他组件条目。

### 2. 项目约定

- **命名约定**: Web 测试标题与断言消息使用简体中文，组件名使用 PascalCase。
- **文件组织**: Web UI 组件位于 `apps/web/components/ui/`，对应轻量契约测试位于 `apps/web/tests/`。
- **导入顺序**: Node 内置模块、第三方依赖、项目相对导入分组排列。
- **代码风格**: TypeScript 测试使用 `node:test` 和 `node:assert/strict`，断言消息直接说明业务约束。

### 3. 可复用组件清单

- `apps/web/tests/source-pruning.test.ts`: 剪枝防回归护栏。
- `apps/web/scripts/phase1-contract-test.mjs`: Web 本地测试转译入口。
- `apps/web/components/ui/LoadingSkeleton.tsx`: 仍接入生产 loading 路由的 UI 组件。
- `apps/web/app/error.tsx`: 真实错误页入口，未导入 ErrorCard。
- `apps/web/app/loading.tsx`: 真实 loading 入口，导入 LoadingSkeleton。

### 4. 测试策略

- **测试框架**: Node test runner，经 `pnpm --filter @storyforge/web test` 调度。
- **测试模式**: 先追加 source-pruning 红灯护栏，再清理源码和脚本残留，最后运行局部与全量验证。
- **参考文件**: `apps/web/tests/source-pruning.test.ts`、`apps/web/tests/ui-components.test.tsx`。
- **覆盖要求**: 验证目标文件不存在、转译脚本无目标引用、LoadingSkeleton 测试继续保留、Web 全量测试和 lint 通过。

### 5. 依赖和集成点

- **外部依赖**: React、Node test runner、pnpm workspace。
- **内部依赖**: `ui-components.test.tsx` 当前导入 ErrorCard 与 LoadingSkeleton；`phase1-contract-test.mjs` 当前为两者提供转译映射。
- **集成方式**: ErrorCard 未接入生产页面；LoadingSkeleton 通过 `apps/web/app/loading.tsx` 接入生产。
- **配置来源**: Web 测试通过 `apps/web/package.json` 的 test/lint 脚本间接执行。

### 6. 技术选型理由

- **为什么用这个方案**: 剪枝删除前先建立失败护栏，可证明候选确实被防回归测试捕获。
- **优势**: 变更范围小，能精确区分未接入 ErrorCard 与仍在生产使用的 LoadingSkeleton。
- **劣势和风险**: 若 phase1 转译脚本清理过宽，可能影响其他 UI 组件测试；因此只删除 ErrorCard 精确条目。

### 7. 关键风险点

- **并发问题**: 无运行时并发影响，本批仅调整源码树和测试脚本。
- **边界条件**: `apps/web/app/error.tsx` 自行渲染错误页，不能误判为 ErrorCard 使用方。
- **性能瓶颈**: 无新增运行时路径，验证成本主要来自 Web 全量测试。
- **安全考虑**: 不修改认证、鉴权、限流、安全响应头或 API 通信逻辑。

### 8. 上下文充分性检查

- 能定义清晰契约：是，本批契约为 ErrorCard 源文件和转译引用不应存在。
- 理解技术选型理由：是，沿用 source-pruning 红灯护栏模式。
- 识别主要风险点：是，主要风险是误删 LoadingSkeleton 或误改真实错误页。
- 知道如何验证实现：是，使用 source-pruning、ui-components、Web 全量测试、lint、残留搜索和 diff-check。
