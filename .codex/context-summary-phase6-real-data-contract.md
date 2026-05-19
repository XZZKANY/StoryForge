## 项目上下文摘要（Phase 6 真实数据源契约）

生成时间：2026-05-19 05:05:00 +08:00

### 1. 相似实现分析

- `docs/architecture/phase6-workbench-contract.md`：当前 Phase 6 契约文档，已记录五页面最小入口、未联通数据源、完全不存在项、竞品启发边界和验收命令。
- `apps/web/tests/phase1-navigation.test.tsx`：现有前端中文契约测试，使用 `assertIncludesAll()` 和源码/文档文本读取保护关键中文入口。
- `.codex/current-phase.md`：当前 Phase 状态索引，已按“已实现 / 已有契约但未持久化 / 完全不存在 / 竞品启发”分类记录 Phase 5/6 状态。

### 2. 项目约定

- 文档、测试描述、日志全部使用简体中文。
- 前端测试使用 Node 内置 `node:test`，不新增测试依赖。
- Phase 6 当前不得新增大型前端架构、跨服务 client 或微服务；真实联动前先明确 API 数据源契约。

### 3. 可复用组件清单

- `assertIncludesAll(content, values, label)`：用于契约关键字断言。
- `readProject(path)` 测试模式：从 web 工作目录读取项目根文档。
- `phase6-workbench-contract.md` 的表格/分节结构：适合继续补“最小 API 数据源契约”。

### 4. 测试策略

- TDD：先扩展 `phase1-navigation.test.tsx`，要求契约文档包含指定数据源契约关键字，观察红灯；再补文档转绿。
- 验证命令：`pnpm --filter @storyforge/web test`、`pnpm --filter @storyforge/web exec tsc --noEmit`。
- 文档收口使用 PowerShell UTF-8 文本断言，避免 Python stdin 中文编码失真。

### 5. 依赖和集成点

- Studio 需要后续接 `books/chapters/scene_packets/judge/repair/approval` 相关 API 数据源，但本轮只写契约。
- Retrieval 需要后续接资料源、刷新任务、搜索请求、命中预览、证据跳转数据源。
- Runs/Artifacts/Evaluations 需要后续接 JobRun、ModelRun、checkpoint、artifact、evaluation 数据源。

### 6. 技术选型理由

- 先补契约和测试，避免在真实数据路径尚未明确时直接写 HTTP client。
- 复用现有文本契约测试可保持小步可验证，并避免新增大型前端状态层。

### 7. 关键风险点

- 如果跳过契约直接实现前端数据 client，容易重复造轮子或误接未稳定 API。
- 如果继续只堆静态入口，Phase 6 无法从展示页推进到可用工作台。
- 当前工作区已有大量未提交变更，本轮不得回滚、不得自动提交。