# 项目上下文摘要（StoryForge IDE 运行时与构建预算）

生成时间：2026-05-28 18:46:16 +08:00

### 1. 相似实现分析

- **实现1**: pps/web/components/ide/performance/budgets.ts
  - 模式：以纯 TypeScript 函数集中声明 IDE 性能预算、测量指标和评估结果。
  - 可复用：measureIdePerformance、createIdePerformanceBaseline、evaluateIdePerformanceBaseline。
  - 需注意：当前只覆盖 SSR 组件级耗时，不读取 Next 构建产物。
- **实现2**: pps/web/tests/ide-performance-budget.test.tsx
  - 模式：使用
ode:test、
ode:assert/strict 与 enderToStaticMarkup 生成可重复本地性能基线，并写入项目 .codex/ 报告。
  - 可复用：测试内生成数据、写报告、断言预算通过的结构。
  - 需注意：测试输出中中文断言曾出现编码显示异常，新增文本应保持 UTF-8。
- **实现3**: pps/web/scripts/phase1-contract-test.mjs
  - 模式：项目自定义测试执行器把 TS/TSX 生产模块转译到临时目录后用 Node 原生测试运行。
  - 可复用：测试文件命名与过滤规则、脚本位于 pps/web/scripts/、报告路径从 process.cwd() 回到仓库根 .codex/。
  - 需注意：新增 TS 生产模块若被测试直接 import，需要加入 runtimeModules；纯 .mjs 脚本可由测试直接 spawn。
- **实现4**: pps/web/tests/phase1-navigation.test.tsx
  - 模式：通过读取源码和配置文件验证构建、Docker、路由等工程契约。
  - 可复用：eadFileSync + ssert.ok 的轻量工程契约测试。
  - 需注意：构建预算需要比静态源码检查更接近真实 .next 产物。

### 2. 项目约定

- **命名约定**: TypeScript 使用 camelCase 函数、PascalCase React 组件；测试名使用中文描述业务意图。
- **文件组织**: IDE 性能运行时逻辑放在 pps/web/components/ide/performance/；可执行 Node 脚本放在 pps/web/scripts/；测试放在 pps/web/tests/；报告写入项目 .codex/。
- **导入顺序**: Node 内置模块在前，第三方库随后，项目内模块最后。
- **代码风格**: 2 空格缩进、单引号、分号、只读类型优先，遵循现有 Prettier/ESLint。

### 3. 可复用组件清单

- pps/web/components/ide/performance/budgets.ts: IDE 性能预算评估工具。
- pps/web/tests/ide-performance-budget.test.tsx: 可复用本地性能基线测试写法。
- pps/web/scripts/phase1-contract-test.mjs: Web 测试运行器和路径规则。
- pps/web/.next/app-build-manifest.json: Next App Router 页面到首屏 chunk 的构建清单。

### 4. 测试策略

- **测试框架**: Web 使用
ode:test、
ode:assert/strict，经 pnpm --filter @storyforge/web test <filter> 运行。
- **测试模式**: 先写失败测试，使用临时 .next fixture 验证 bundle gzip 预算脚本契约；再实现脚本。
- **参考文件**: pps/web/tests/ide-performance-budget.test.tsx、pps/web/tests/phase1-navigation.test.tsx。
- **覆盖要求**: 正常流程输出 .codex 报告；缺失 /ide/page manifest 时应明确失败；预算目标与阻断阈值应可审计。

### 5. 依赖和集成点

- **外部依赖**: Node 内置 s、path、zlib、perf_hooks，不新增 npm 依赖。
- **内部依赖**: Next 构建产物 .next/app-build-manifest.json 与 .next/static/*；现有 IDE SSR 性能工具。
- **集成方式**: 新增脚本可独立执行；测试通过 child_process 调用脚本并读取 JSON 报告。
- **配置来源**: pps/web/package.json 的 uild 与 	est 脚本；master plan §13.3 的目标和阻断阈值。

### 6. 技术选型理由

- **为什么用这个方案**: 不引入 Playwright 或 bundle analyzer，先用 Next 官方构建清单和 gzip 计算补齐可重复本地基线。
- **优势**: 可在当前依赖内稳定运行，输出 JSON 证据，和现有 .codex 工作流一致。
- **劣势和风险**: bundle gzip 能映射 /ide/page chunk；TTI 只能先提供 SSR/Node 代理指标，不等同真实浏览器 TTI。

### 7. 关键风险点

- **并发问题**: 多测试同时写 .codex 报告可能互相覆盖；本轮测试使用独立临时输出路径，实际脚本默认写固定报告。
- **边界条件**: .next 不存在、manifest 缺少 /ide/page、chunk 文件缺失均要明确失败。
- **性能瓶颈**: gzip 读取 chunk 文件数量有限；无需引入昂贵依赖。
- **安全考虑**: 本任务只读取构建产物并写本地报告，不处理凭据和用户目录。
