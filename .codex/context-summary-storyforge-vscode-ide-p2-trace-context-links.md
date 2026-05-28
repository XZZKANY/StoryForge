## 项目上下文摘要（StoryForge VS Code IDE P2 Trace Context Links）

生成时间：2026-05-28 13:45:00 +08:00

### 1. 相似实现分析

- **实现1**: `apps/api/app/domains/ide/service.py` 的 `_artifact_trace`
  - 模式：从 Artifact payload 和 audit chapters 中提取 `book_run_id`、`model_run_id`、`judge_report_id`、`approved_scene_id`，生成 `/ide?...` trace href。
  - 可复用：同一 trace link 可追加 `compiled_context_id` 派生的 `/ide?inspector=...`。
  - 需注意：不要自造 ModelRun/Repair 数据源，优先从既有 payload/chapter trace 读取。
- **实现2**: `apps/web/components/ide/views/ArtifactViewer.tsx`
  - 模式：展示 BookRun → ModelRun → JudgeReport → Approve 反向追溯链，使用 `data-trace-*` 机器可读属性。
  - 可复用：为 ModelRun/JudgeReport/Approve trace 项补充 `data-context-href` 和上下文链接。
  - 需注意：BookRun 本身不一定对应单一上下文，入口应聚焦 ModelRun/Repair/Approve。
- **实现3**: `apps/api/tests/test_ide_artifact_preview.py`
  - 模式：创建 Artifact payload 后验证 IDE artifact preview 聚合 trace。
  - 可复用：红灯测试可在 payload 和 chapters 中加入 `compiled_context_id`，验证 API 返回 context_href。
  - 需注意：需覆盖直接 payload 和 audit chapters 两种来源。
- **实现4**: `apps/web/components/ide/views/ContextInspector.tsx`
  - 模式：已有 `/ide?inspector=ctx_unit` 来源入口展示。
  - 可复用：Artifact trace 的 context link 目标应复用同一 URL 约定。
  - 需注意：这是只读入口，不涉及 CommandRegistry 写路径。

### 2. 项目约定

- **命名约定**: 后端 schema 字段使用 snake_case；前端 props 字段使用 camelCase；trace kind 使用 snake_case。
- **文件组织**: 后端聚合在 `apps/api/app/domains/ide/`；前端展示在 `apps/web/components/ide/views/`。
- **导入顺序**: 标准库、第三方、项目模块分组；前端保持现有组件内局部 helper。
- **代码风格**: 简体中文文档和测试，SSR 契约使用 `data-*` 属性。

### 3. 可复用组件清单

- `IdeArtifactTraceLink`: 制品 trace 链接 schema。
- `_artifact_trace` / `_first_chapter_trace`: 从制品 payload 提取追溯字段。
- `ArtifactViewer.TraceItem`: trace item 渲染和 data 属性出口。
- `/ide?inspector=<compiled_context_id>`: P2 已接通的 Context Inspector URL。

### 4. 测试策略

- **测试框架**: 后端 `pytest` + FastAPI TestClient；前端 `node:test` + React SSR。
- **测试模式**: 先改 API 测试要求 trace link 返回 `context_href`；再改前端组件测试要求 `data-context-href` 和“上下文”链接。
- **参考文件**: `apps/api/tests/test_ide_artifact_preview.py`、`apps/web/tests/ide-components.test.tsx`、`tests/e2e/ide-judge-repair.spec.ts`。
- **覆盖要求**: payload 直接 `compiled_context_id`、audit chapters `compiled_context_id`、前端 trace data 属性和 e2e 源码契约。

### 5. 依赖和集成点

- **外部依赖**: 无新增。
- **内部依赖**: Artifact payload、IdeArtifactTraceLink、ArtifactViewer、Context Inspector URL。
- **集成方式**: `compiled_context_id` → `context_href=/ide?inspector=<id>`。
- **配置来源**: 无新增配置。

### 6. 技术选型理由

- **为什么用这个方案**: 主计划 P2 触发点是 ModelRun、Repair、Approve 旁的上下文图标；Artifact trace 是现有最真实的 ModelRun/Judge/Approve 追溯 UI。
- **优势**: 复用现有 Artifact Preview 聚合和 trace UI，不新增写命令、不新增端点。
- **劣势和风险**: RepairPatch 目前没有独立 trace 节点，短期通过 JudgeReport/Approve 链路承载上下文入口；后续可新增 Repair 专用 trace。

### 7. 关键风险点

- **并发问题**: 无新增并发。
- **边界条件**: payload/chapter 缺少 `compiled_context_id` 时不得生成空 context href。
- **性能瓶颈**: 仅字符串提取和链接生成，无额外查询。
- **安全考虑**: 只读链接，不新增认证、鉴权或写入逻辑。
