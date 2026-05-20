# 项目上下文摘要（端到端闭环收口）

生成时间：2026-05-21 00:41:00 +08:00

## 1. 相似实现分析

- **实现1**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-ph5-ph6-closure.md`
  - 模式：用“相似实现分析、项目约定、可复用组件、测试策略、风险点”收口阶段事实。
  - 可复用：不复制长日志，只保留可执行事实入口和验证计划。
  - 需注意：不能把后续待办夸大为完整闭环。
- **实现2**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/architecture/phase6-workbench-contract.md`
  - 模式：用矩阵区分已实现、已有契约但未联通、完全不存在。
  - 可复用：本轮改为“已完成最小执行/摘要、剩余交互/详情增强、明确不代表”。
  - 需注意：Artifacts download 只能写 `payload_preview` 摘要，不能写对象存储签名 URL。
- **实现3**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/current-phase.md`
  - 模式：作为当前 Phase 主事实入口，短表格承接 TODO 与验证入口。
  - 可复用：风险状态表、状态区分、后续建议。
  - 需注意：不复制 `.codex/operations-log.md` 长流水。
- **实现4**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/docs/architecture/workflow-modelrun-adapter-contract.md`
  - 模式：明确 workflow runtime 字符串 ID 与 API `JobRun.id:int` 的边界。
  - 可复用：最小真表 adapter/client 已有，仍不是新微服务。
  - 需注意：HTTP 传输和真实 provider 端到端仍是后续增强。
- **实现5**：`D:/StoryForge/1-renovel-ai-ai-rag-tavern/.codex/context-summary-studio-approve-execution.md`
  - 模式：记录 Studio 批准写回执行的复用路径和 Web 边界。
  - 可复用：`POST /api/studio/approve` 复用既有章节写回服务。
  - 需注意：页面展示执行入口契约，不等于完整交互式按钮流。

## 2. 项目约定

- **语言约定**：文档、注释、日志、测试描述和审查说明使用简体中文；API path 与代码标识符保持原文。
- **文件组织**：治理事实入口在 `.codex/current-phase.md`，阶段任务池在 `TODO.md`，架构契约在 `docs/architecture/`。
- **编辑边界**：本轮只允许写入四个文件，不修改 API、Web、workflow、OpenAPI 生成物、`.codex/operations-log.md` 或 `.codex/verification-report.md`。
- **状态表达**：优先写“已完成最小执行/摘要”和“剩余交互/详情增强”，避免写成完整产品闭环。

## 3. 本轮已知事实

- Workflow-to-API：已有最小真表 adapter/client，workflow runtime 可把 ModelRun payload 写入 API 真表；它不是新微服务。
- Studio：approval-summary/recovery-summary 已可读取；`POST /api/studio/approve` 已实现真实批准写回，ScenePacket/RepairPatch 可写回章节、场景和 continuity；页面当前展示执行入口契约，不是完整交互式按钮流。
- Runs：`GET /api/model-runs/job-runs/{job_run_id}` 真实读取；`POST /api/model-runs/job-runs/{job_run_id}/retry` 创建恢复任务，不是立即续跑 workflow；Web 已展示 retry 执行契约、可创建恢复任务和缺少 checkpoint 时不可重试边界。
- Artifacts：`GET /api/artifacts`、`GET /api/artifacts/{artifact_id}`、`GET /api/artifacts/{artifact_id}/download` 已有；download 当前是 `payload_preview` 下载摘要，不是对象存储签名 URL。
- Evaluations：`GET /api/evaluations/runs`、`GET /api/evaluations/runs/{run_id}`、`GET /api/evaluations/runs/{run_id}/failed-samples` 已有；当前是趋势摘要、失败样例和 Studio 反馈入口摘要，不是复杂图表或自动反馈执行。
- 发布治理：Alembic 干净临时库验证已纳入门禁，但本轮最终验证由主线程执行。

## 4. 依赖与集成点

- **内部依赖**：Studio 写回依赖章节/场景/continuity 写回服务；Runs retry 依赖 JobRun checkpoint；Artifacts download 依赖 Artifact payload；Evaluations 摘要依赖 EvaluationRun metrics。
- **外部依赖**：本轮不新增外部依赖；不需要 context7 查询库文档；当前环境未提供 `github.search_code` 工具，未执行开源代码搜索。
- **事实冲突处理**：若 registry、页面和文档状态不一致，以用户事实基线、API/Web 实际行为和 `.codex/current-phase.md` 主事实入口为本轮治理准线。

## 5. 验证计划

- 必跑：`git diff --check`。
- 建议主线程复核：API 定向测试、Web 契约测试、TypeScript 检查、workflow runtime 测试和 Alembic 干净临时库门禁。
- 写入范围核对：检查 diff 是否只包含本轮允许的四个文件；若工作区已有其他代理改动，只记录为既有背景，不回滚、不覆盖。

## 6. 风险边界

- 不把 retry 创建恢复任务写成“立即续跑 workflow”。
- 不把 `payload_preview` 写成对象存储签名 URL。
- 不把趋势摘要写成复杂图表，也不把 Studio 反馈入口写成自动反馈执行。
- 不把 Web 执行入口契约写成完整交互式按钮流。
- 不替主线程声明最终发布验证完成。
- 不删除旧证据，不复制 `.codex/operations-log.md` 长流水。

## 7. 充分性检查

- 能定义清晰契约：是，本轮交付为四个治理文档文件，输入为事实基线与只读代码证据，输出为收口矩阵、任务池状态、主事实入口和上下文摘要。
- 理解技术选型理由：是，继续采用模块化单体和现有 API/Web/workflow 分层，不新增微服务或全量 client。
- 识别主要风险点：是，重点风险是夸大最小摘要读取、混淆 retry 语义、误写签名 URL 或复杂图表。
- 知道如何验证实现：是，至少运行 `git diff --check`，并由主线程补充最终发布验证。
