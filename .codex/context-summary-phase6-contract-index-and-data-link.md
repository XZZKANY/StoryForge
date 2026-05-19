## 项目上下文摘要（Phase 6 契约索引与数据联动收口）

生成时间：2026-05-19 04:05:00 +08:00

### 1. 相似实现分析

- `README.md` 的“重要文档”集中维护总计划、OpenAPI、运维索引、验证报告和操作日志入口；适合纳入 Phase 6 契约文档链接。
- `.codex/current-phase.md` 以“已实现 / 已有契约但未持久化 / 完全不存在 / 竞品启发”记录当前事实；适合承载 Phase 6 状态索引与下一步数据联动优先级。
- `apps/web/tests/phase1-navigation.test.tsx` 通过读取源码文本做中文契约断言；适合继续覆盖 Phase 6 页面入口和契约文档边界。

### 2. 项目约定

- 文档、测试描述、日志均使用简体中文。
- 前端契约测试使用 Node 内置 `node:test`、`node:assert/strict` 和 `readFileSync`，不引入新测试框架。
- Phase 6 当前只推进模块化单体内页面与契约闭环，不新增大型状态管理、HTTP client 或微服务。

### 3. 可复用组件清单

- `assertIncludesAll()`：复用在中文契约测试中断言页面或文档包含关键入口。
- `assertCleanChineseContract()`：复用中文字符和损坏占位符检查。
- `.codex/current-phase.md`：复用为当前事实入口，避免继续堆长日志。

### 4. 测试策略

- 主要验证：`pnpm --filter @storyforge/web test`。
- 类型验证：`pnpm --filter @storyforge/web exec tsc --noEmit`。
- 文档索引与状态收口使用临时 Python 文本断言，验证关键路径和状态分类存在。

### 5. 依赖和集成点

- `README.md` 是项目级文档入口。
- `docs/architecture/phase6-workbench-contract.md` 是 Phase 6 工作台契约来源。
- `TODO.md` 与 `.codex/current-phase.md` 是后续代理恢复优先级的主要入口。

### 6. 技术选型理由

- 继续使用现有 Markdown 索引和源码文本契约测试，改动小、可本地验证、符合总计划第 11.9 的审计噪音治理方向。
- 不实现真实 API client，因为当前任务要求优先闭环 Phase 文档/测试，不新增大型架构模块。

### 7. 关键风险点

- 如果只新增静态页面入口而不收口真实数据联动优先级，后续代理可能继续堆 UI 文案。
- 如果 Phase 6 契约文档未纳入 README 或测试，容易变成文档孤岛。
- 当前工作区已有大量未提交变更，本轮不得回滚、不得自动提交。