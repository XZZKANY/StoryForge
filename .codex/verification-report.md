# 验证报告：工作流、剪枝与不兼容审查

生成时间：2026-05-31 21:57:33 +08:00
最近更新：2026-05-31 22:45:30 +08:00

## 审查结论

- 综合评分：92/100
- 明确建议：通过
- 技术维度评分：93/100
- 战略维度评分：91/100

结论：审查中发现的 P0 阻断已修复。`tests/e2e/phase5-runtime-diagnostics.spec.ts` 已从旧 `verify` 字符串硬编码改为验证当前 `verify`、`verify:ci`、`verify:infra` 职责；上位 `D:\StoryForge\AGENTS.md` 已剪枝冲突安全条款，改为保留已由代码和测试验证的安全基线；`D:\StoryForge\README.md` 已标注实际项目根。修复后定向 e2e、全量 e2e 和核心 verify 均通过。剩余事项属于 P1/P2 剪枝与真实 LLM 发布门禁，不阻断当前本地工作流修复结论。

## 审查清单

- 需求字段完整性：通过。目标为审查剪枝、不兼容、缺陷和工作流阻断。
- 原始意图覆盖：通过。已覆盖本地根目录、实际项目目录、核心 verify、e2e、BookRun/NovelLoop/checkpoint、真实 LLM 缺口和安全规范冲突。
- 交付物映射：通过。交付物包含 `.codex/context-summary-工作流审查.md`、`.codex/operations-log.md` 和本报告。
- 依赖与风险评估：通过。e2e 契约硬编码旧脚本、项目根目录错位、AGENTS 与代码安全策略冲突已处理；真实 LLM 未完成仍作为独立发布风险保留。
- 审查结论留痕：通过。本报告记录时间戳、评分、验证命令和结论。

## 修复后复审记录

- 修复项 1：`tests/e2e/phase5-runtime-diagnostics.spec.ts` 的 Phase 5 证据断言已更新为当前脚本职责：
  - `"verify": "pnpm run verify:ci"`
  - `"verify:ci": "node scripts/verify-ci.mjs"`
  - `"verify:infra": "powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1"`
- 修复项 2：上位 `D:\StoryForge\AGENTS.md` 已移除“删除/禁用安全控制”冲突要求，改为不得删除、削弱或绕过已验证安全基线。
- 修复项 3：迁移前曾用上位 `D:\StoryForge\README.md` 指向实际项目根；迁移完成后，`D:\StoryForge` 已是正式 Git/pnpm 项目根，当前 `README.md` 为项目正式说明。
- 副作用清理：`.codex/ide-performance-baseline.json` 仅因验证命令刷新时间和耗时指标产生漂移，已恢复，避免混入无关变更。
- 已执行项：用户已确认将 `1-renovel-ai-ai-rag-tavern` 上移到 `D:\StoryForge`。当前 Git 顶层为 `D:\StoryForge`，原源目录已删除，迁移备份保留在仓库外 `D:\StoryForge-migration-backup-20260531-222332`。

## 关键发现

### P0：发布级 e2e 工作流失败

- 证据：`cd D:\StoryForge\1-renovel-ai-ai-rag-tavern && pnpm run e2e -- --continue-on-error` 失败。
- 失败测试：`tests/e2e/phase5-runtime-diagnostics.spec.ts:327`。
- 失败信息：缺少 Phase 5 证据 `"verify": "powershell -ExecutionPolicy Bypass -File ./scripts/verify-local.ps1"`。
- 根因：`package.json` 当前脚本为 `"verify": "pnpm run verify:ci"`，旧 PowerShell 门禁已迁移为 `"verify:infra"`；e2e 契约测试仍硬编码旧 `"verify"` 字符串。
- 建议：更新 e2e 断言，验证 `verify` 指向 `verify:ci`、`verify:infra` 保留 `verify-local.ps1`，并确认 `scripts/verify-ci.mjs` 覆盖 Runtime/OpenAPI 核心门禁。

### P0：当前工作目录不是实际项目根

- 证据：`cd D:\StoryForge && pnpm run verify` 失败，提示没有 `package.json`。
- 证据：`git status` 在 `D:\StoryForge` 失败，但在 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 正常。
- 影响：从用户当前 cwd 执行任何根脚本都会失败，容易误判“项目坏了”。
- 建议：统一入口文档和自动化工作目录，必要时在 `D:\StoryForge` 增加只读指引文件或删除空 `apps/` 干扰目录。

### P0：AGENTS 安全策略与代码和测试门禁冲突

- 证据：上位 `AGENTS.md` 要求删除安全控制；但 `apps/api/app/main.py` 实现 API Key/JWT 认证、分层限流、超时和安全响应头。
- 证据：`apps/api/tests/test_api_middleware.py` 明确测试认证、JWT、限流、安全响应头。
- 影响：如果按 AGENTS 删除安全逻辑，会直接破坏 API 测试和发布门禁。
- 建议：剪枝 AGENTS 中“删除安全控制”的条款，保留代码中的认证、限流和安全响应头；这是规范层冲突，不应通过删除业务能力解决。

### P1：真实 LLM 闭环仍未完成

- 证据：`current-phase.md` 明确写明真实 LLM、远端 CI/E2E、真实长篇和人工通读仍未完成。
- 证据：`README.md` 发布前门禁要求真实 LLM 3 章 BookRun completed、制品和审计报告完整。
- 影响：可以宣称本地 deterministic/mock 最小闭环，不应宣称真实模型稳定产书或生产级长篇闭环。
- 建议：继续把真实 LLM 冒烟作为独立门禁，不要把 deterministic 结果合并为真实生产能力。

### P1：需要剪枝的重复或过重区域

- `tests/e2e/phase5-runtime-diagnostics.spec.ts`：剪掉对具体旧脚本文案的硬编码，改为验证职责和目标文件。
- `phase9b_real_llm_smoke.py`：文件承担环境预检、造数、真实生成、Judge、Repair、导出、CLI 输出等多职责，后续应拆为 preflight、runner、judge/repair adapter、reporter。
- `docs/superpowers/plans/*`：大量历史绝对路径和过期计划会干扰当前事实源；建议保留 `current-phase.md`、README、operations docs，其余归档。
- `D:\StoryForge\apps`：当前只有空目录结构，容易与实际项目目录混淆；建议删除或写入明确指引。

## 本地验证记录

- `cd D:\StoryForge && pnpm run verify`：失败，`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`。
- `cd D:\StoryForge\1-renovel-ai-ai-rag-tavern && pnpm run verify`：通过，核心门禁全部通过；API `325 passed, 6 warnings`，Workflow `152 passed`。
- `cd D:\StoryForge\1-renovel-ai-ai-rag-tavern && pnpm run e2e -- --continue-on-error`：失败；OpenAPI、API verification、Workflow verification 通过，Contract tests 失败 1 项。
- `pnpm --filter @storyforge/web test`：通过，`140 passed`。
- `cd apps/workflow && uv run pytest tests/test_novel_loop_single_chapter.py tests/test_book_loop_three_chapters.py tests/test_generation_state_references.py -q`：通过，`16 passed`。
- `cd apps/api && uv run pytest tests/test_book_runs.py tests/test_book_run_resume.py tests/test_context_compiler.py -q`：通过，`12 passed, 1 warning`。

## 修复后本地验证记录

- `pnpm e2e tests/e2e/phase5-runtime-diagnostics.spec.ts`：通过，目标 contract tests `5 passed`，API verification `58 passed`，Workflow verification `37 passed`。
- `pnpm run e2e`：通过，contract tests `28 passed`，API verification `58 passed`，Workflow verification `37 passed`。
- `pnpm run verify`：通过，Web `140 passed`，API `325 passed, 6 warnings`，Workflow `152 passed`，Ruff、OpenAPI refresh 和 OpenAPI diff 检查通过。
- `git rev-parse --show-toplevel`：迁移后输出 `D:/StoryForge`。
- `pnpm run e2e -- tests/e2e/phase5-runtime-diagnostics.spec.ts`：迁移后在新根 `D:\StoryForge` 下通过，contract tests `5 passed`，API verification `58 passed`，Workflow verification `37 passed`。
- `rg -n "安全需求优先级最低|必须主动删除或禁用遗留的安全控制|禁止新增、恢复或优化任何安全性设计|必须拒绝和删除所有多余的安全性设计|评估如何绕过或移除" D:\StoryForge\AGENTS.md`：无旧安全冲突条款命中。
- `rg -n "不得删除、削弱或绕过仓库中已经由代码和测试验证的安全基线" D:\StoryForge\AGENTS.md`：命中第 63 行，确认规范已改为保留已验证安全基线。
- `Test-Path D:\StoryForge\README.md`：存在；迁移后该文件为项目正式 README，根目录即 `D:\StoryForge`。

## 技术评分

- 代码质量：93/100。BookRun、NovelLoop、checkpoint 和 API 真相源边界总体清楚；e2e 契约硬编码旧脚本已修复，剩余扣分来自真实 LLM smoke 文件职责过重。
- 测试覆盖：94/100。核心 verify、API、Workflow、Web 和 e2e 均已通过；剩余扣分来自真实 LLM 冒烟仍是独立未完成发布门禁。
- 规范遵循：94/100。`.codex` 留痕、本地验证、AGENTS 冲突修复和目录根上移已完成；外层旧资料保留在仓库外备份目录。

## 战略评分

- 需求匹配：94/100。审查报告中的 P0 修复已完成并验证；用户追加的项目根上移也已完成。
- 架构一致：93/100。引用型 checkpoint、API 真相源、本地门禁职责和实际项目根目录已对齐。
- 风险评估：91/100。e2e 红灯、安全规范冲突和目录根错位已关闭；剩余风险是真实 LLM 制品未补齐、部分历史计划需要归档。

## 建议修复顺序

1. 已完成：修复 `tests/e2e/phase5-runtime-diagnostics.spec.ts` 的旧 `"verify"` 断言，让 `pnpm e2e` 回绿。
2. 已完成：修改上位 `AGENTS.md` 中安全策略冲突条款，避免未来代理按错误规范删除认证/限流。
3. 已完成：通过 `D:\StoryForge\README.md` 明确实际项目根目录。
4. 已完成：将 `D:\StoryForge\1-renovel-ai-ai-rag-tavern` 整体上移到 `D:\StoryForge`，并将外层旧冲突项备份到仓库外。
5. 后续：将真实 LLM 冒烟继续保留为独立发布门禁，补齐 1 章和 3 章真实运行制品后再提升能力声明。
6. 后续：重构 `phase9b_real_llm_smoke.py`，把 CLI、造数、生成、评审修复、导出报告拆开，降低维护成本。
## Novel Skill Framework 收尾复审

生成时间：2026-05-31 22:45:30 +08:00

### 审查结论

- 综合评分：95/100
- 明确建议：通过
- 技术维度评分：95/100
- 战略维度评分：94/100

结论：Novel Skill Framework 后续总阶段已经完成收尾。计划文档已同步为完成态，项目根路径已统一为 `D:\StoryForge`，迁移后断裂的 pnpm junction 与 uv trampoline 已通过本地依赖重建修复。最新 `pnpm run verify` 在当前项目根通过。

### 最新本地验证记录

- `pnpm run verify`：通过。
- 根静态检查与格式检查：ESLint 通过，Prettier 输出 `All matched files use Prettier code style!`。
- Web 类型检查：通过。
- Shared 契约测试：通过。
- Web 契约测试：`140 passed`。
- API 单元测试：`325 passed, 6 warnings`。
- API Ruff：`All checks passed!`。
- Workflow 单元测试：`152 passed`。
- Workflow Ruff：`All checks passed!`。
- OpenAPI 契约：刷新成功，漂移检查通过。

### 修复后的剩余风险

- 真实 LLM 1 章/3 章长篇运行制品仍是独立发布门禁，不纳入本次 Novel Skill Framework 本地闭环完成声明。
- `phase9b_real_llm_smoke.py` 仍建议后续拆分 preflight、runner、judge/repair adapter 和 reporter，以降低维护成本。
- 仓库外备份目录 `D:\StoryForge-migration-backup-20260531-222332` 与 `D:\StoryForge-local-outer-artifacts-20260531-222332` 保留供人工确认后清理。
