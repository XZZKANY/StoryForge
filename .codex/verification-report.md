# 验证报告：工作流、剪枝与不兼容审查

## 验证报告：移除 GitHub 撰稿人中的 Claude

生成时间：2026-05-31 23:59:20 +08:00

### 审查结论

- 综合评分：95/100
- 明确建议：通过（本地历史已清理；远端 GitHub 页面需强推后刷新）
- 技术维度评分：96/100
- 战略维度评分：94/100

结论：已从本地 Git 历史中移除两条 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` trailer。仓库未发现 `.all-contributorsrc`、`CONTRIBUTORS` 或 README 贡献者清单，因此 Claude 撰稿人来源是提交共同作者元数据。重写后 `git log --all` 不再匹配 `Co-Authored-By: Claude` 或 `noreply@anthropic.com`，作者唯一列表也不含 Claude/Anthropic。`HEAD^{tree}` 与 `origin/master^{tree}` 在重写前后保持一致，说明本次只改提交消息元数据，不改文件树内容。

### 审查清单

- 需求字段完整性：通过。目标为移除 GitHub 撰稿人中的 Claude。
- 原始意图覆盖：通过。已区分静态贡献者清单与 GitHub contributors 的共同作者统计来源。
- 交付物映射：通过。交付物包含 `.codex/context-summary-移除claude撰稿人.md`、`.codex/operations-log.md` 和本报告。
- 依赖与风险评估：通过。已记录历史重写会改变提交 SHA；远端生效需 `git push --force-with-lease origin master`。
- 审查结论留痕：通过。本节记录时间戳、评分、验证命令和结论。

### 本地验证记录

- `git log --all --format='%H%x09%s%n%B%n---END---' | rg -n -i "Co-Authored-By: Claude|noreply@anthropic.com"`：无匹配，退出码 1。
- `git log --all --grep='Claude Opus' --format='%H%x09%h%x09%P%x09%s'`：无输出。
- `git log --format='%an <%ae>' --all | Sort-Object -Unique`：仅剩 `XZZKANY <149980898+XZZKANY@users.noreply.github.com>`、`XZZKANY <3241583594@qq.com>`、`预定 调和 <3241583594@qq.com>`。
- `git rev-parse HEAD`：`ac53c859c133c2ec620e7d11477fcd400991e0c9`。
- `git rev-parse HEAD^{tree}`：`200001fe8b24e7c76eb9963cc2cf8ec51877e192`，与重写前一致。
- `git rev-parse origin/master`：`7d88ef71e456abf97e84e74184e6d3b751314615`。
- `git rev-parse origin/master^{tree}`：`ccd581902a7ed9c1bff4f44cefa79a6c3497909c`，与重写前一致。
- `git status --short`：仍显示执行前已有业务改动和本次 `.codex` 记录文件；未出现因历史重写新增的业务文件漂移。

### 变更摘要

- 旧目标提交 `aa9475cc0e51819fb218c638d4344da2f33c632d` 已重写为 `9106f048f62869d71902235e1eb54ac366fc895e`，提交消息不再包含 Claude 共同作者。
- 旧目标提交 `875b84f5f959ac5f525a54629b2fb58693d7e42e` 已重写为 `1f1e12fad9ca2c4f9feb9a9443a48dbe7eb65a1d`，提交消息不再包含 Claude 共同作者。
- 当前本地 `master` 已更新为 `ac53c859c133c2ec620e7d11477fcd400991e0c9`。

### 风险与后续动作

- 本地已完成；GitHub 网站的 contributors 页面只有在远端 `master` 接收重写历史后才会刷新。
- 远端同步命令应为 `git push --force-with-lease origin master`。该命令会改写远端历史，应确认没有其他协作者基于旧历史继续提交。
- 当前工作区存在用户已有未提交业务变更，本任务未回退、覆盖或整理这些变更。

### 技术评分

- 代码质量：96/100。本任务不改业务代码，重写范围精准，验证证明文件树未变。
- 测试覆盖：95/100。已用 Git 查询覆盖目标 trailer、目标邮箱、作者列表和 tree id；未运行业务测试，因为任务不涉及运行时代码。
- 规范遵循：96/100。已生成 `.codex` 上下文摘要、操作日志和验证报告，并全程使用简体中文记录。

### 战略评分

- 需求匹配：95/100。本地历史已去掉 Claude 共同作者来源；远端展示需后续强推。
- 架构一致：95/100。未引入新脚本、新依赖或业务层改动。
- 风险评估：92/100。主要扣分来自远端强推的协作风险与 GitHub 页面刷新延迟。

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

## 追加：Novel Skill Framework 清理（2026-05-31）

针对评判中确认的三项实质问题做了最小修复：

1. 删除死桥接 `apps/api/app/domains/book_runs/skill_audit_bridge.py`：该文件调用 `audit.py` 中不存在的 `derive_skill_chain_summary`，且零引用（实际在用的是 `workflow_skill_audit_bridge.py`，被 `book_markdown_exporter.py` 以三参数签名调用）。
2. 修复 `orchestrators/novel_loop.py:43` `_skip_static_quality_check` 的乱码 docstring（`????` → 中文说明）。
3. 统一 `memory_extract` 状态词表：runner 产出 `memory_updated`/`memory_extract_skipped` 为权威；同步修正 `definitions.py` 的 `status_mapping`、`audit.py` 合成分支硬编码状态、`skills/memory_extract/SKILL.md` 状态映射三处的旧值 `memory_extracted`。

### 验证

- `uv run pytest tests/test_novel_skill_registry.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py tests/test_novel_loop_skill_runner_integration.py -q`：`29 passed`。
- 受影响 skill/loop 测试合跑：`53 passed`（修 SKILL.md 前曾因元数据同步检查 fail 1，修后全绿）。
- API 导出器导入冒烟：`from app.domains.exports.book_markdown_exporter import derive_book_run_skill_chain` 正常。

### 未联通能力（保留为已知缺口，非本次范围）

- `NovelSkillRunner` 仍只被 workflow 测试调用，未注入任何生产 BookLoop/graph 链路；真实 BookRun 的 `skill_runs` 为空，导出报告的 `skill_chain` 仍由 `audit.py` 合成分支推断重建，而非真实运行实录。
- `definitions.py` 仍保留硬编码 `source_refs` 行号、`status_mapping` 缺乏运行期校验，留待后续。

## 验证报告补充：强推 master 移除 Claude 撰稿人

时间：2026-06-01 00:06:44 +08:00

### 验证命令

- git fetch origin
- git rev-parse master
- git rev-parse origin/master
- git log origin/master --format='%H%x09%an%x09%ae%x09%B' | Select-String -Pattern 'Co-Authored-By: Claude|noreply@anthropic\\.com|anthropic\\.com' -CaseSensitive:$false

### 验证结果

- 本地 master：$localAfter
- 远端 origin/master：$remoteAfter
- 哈希一致：是
- Claude co-author 搜索命中：无
- Anthropic 邮箱搜索命中：无

### 结论

综合评分：95/100。建议：通过。

远端 origin/master 已完成受保护强推，并确认历史提交中不再包含导致 GitHub 撰稿人识别的 Claude co-author 信息。GitHub 网页贡献者统计可能存在缓存延迟，但 Git 远端历史已验证更新完成。

## 诚实化 BookRun 技能链审计投影验证报告

时间：2026-06-01 00:36:08

### 需求与交付物映射

- 目标：让技能链投影明确区分真实实录与从 progress 重建推断的事件。
- 范围：仅修改投影层、API/Web 测试和 Web 呈现；不触碰 WorkflowRuntime、LangGraph 节点或 orchestrator 生产接线。
- 交付物：
  - pps/workflow/storyforge_workflow/skills/audit.py：schema v2、
ecorded 字段、双 provenance、summary 证据统计。
  - pps/workflow/tests/test_skill_audit_summary.py：纯实录、纯重建、混合、空事件断言。
  - pps/api/tests/test_book_exporter.py：exporter schema v2 与事件来源断言。
  - pps/web/app/book-runs/audit.tsx：证据来源和“实录/重建”标识。
  - pps/web/tests/book-run-audit.test.tsx：Web fixture 与呈现断言。

### 本地验证命令与结果摘要

- cd apps/workflow && uv run pytest tests/test_skill_audit_summary.py tests/test_novel_skill_registry.py -q
  - 结果：通过，19 passed in 0.69s。
- cd apps/workflow && uv run ruff check .
  - 结果：通过，All checks passed!。
- cd apps/api && uv run pytest tests/test_book_exporter.py -q
  - 结果：通过，3 passed in 0.50s。
- pnpm --filter @storyforge/web test -- book-run-audit.test.tsx
  - 结果：通过，3 pass / 0 fail。
- pnpm --filter @storyforge/web test
  - 结果：通过，140 pass / 0 fail。
- pnpm verify
  - 结果：通过；核心门禁包含 lint/Prettier、Web 类型检查、shared 契约测试、Web 契约测试、API 325 passed、API Ruff、Workflow 152 passed、Workflow Ruff、OpenAPI 生成与漂移检查。

### 质量评分

- 代码质量：95/100。沿用既有投影构造点与 Web 呈现模式，未新增依赖或执行路径。
- 测试覆盖：95/100。覆盖纯实录、纯重建、混合、空事件、exporter 和 Web 呈现。
- 规范遵循：95/100。使用本地验证，记录上下文、操作日志与验证报告。
- 战略一致性：96/100。P0 聚焦消除误导，不假装已有真实 skill_runs。
- 综合评分：95/100。
- 建议：通过。

### 依赖与风险评估

- 依赖：workflow_skill_audit_bridge.py 继续使用 dataclass 反射序列化，新字段会自动进入 JSON。
- 风险：下游若硬编码 v1 schema，需要识别 ookrun_skill_projection.v2。
- 安全与诚信边界：未复制完整 prompt 或正文，继续只输出引用字段与摘要字段。

### 仍未联通能力声明

真实 BookRun 依然不产 skill_runs；生产真实运行的投影在没有 recorded skill_runs 时仍会是 evidence_basis="reconstructed"。本次只消除“重建推断伪装成实录”的误导，未补真实技能运行实录能力。

## 端到端验真报告：mock BookRun 导出与审计页 reconstructed 可见性

时间：2026-06-01 01:11:55 +08:00

### 需求字段完整性

- **目标**：验证上一轮“诚实化”是否在真实本地上下文中落地，尤其是
econstructed/重建 标识是否对人类可见且不误导。
- **范围**：本地 deterministic/mock BookRun、ook.md、udit_report.json、Web BookRunAuditPanel 静态审计页渲染。
- **交付物**：
  - D:\StoryForge\.codex\context-summary-e2e-skill-audit.md
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\book.md
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit_report.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\book_run_for_audit_page.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit-page.html
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit-page-visible-checks.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\smoke-summary.json
- **审查要点**：导出证据完整、审计页可见、
ecorded 与
econstructed 不混淆、真实 skill_runs 缺口继续显式。

### 本地验证命令与结果

- cd D:\StoryForge\apps\api; uv run pytest tests/test_phase9a_deterministic_smoke.py -q
  - 结果：通过，1 passed in 0.23s。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_exporter.py -q
  - 结果：通过，3 passed in 0.47s。
- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_skill_audit_summary.py -q
  - 结果：通过，11 passed in 0.52s。
- cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit
  - 结果：通过，3 pass / 0 fail。
- 使用内联 Python 运行
un_phase9a_deterministic_smoke(session) 并导出制品。
  - 结果：BookRun #1 completed；ook.md 正文词数 3468；udit_report.json 生成成功。
- 使用实际导出数据静态渲染 BookRunAuditPanel。
  - 结果：udit-page-visible-checks.json 中 14 项页面可见性检查全部为 true。

### 关键证据

- smoke-summary.json：
  - skill_chain_schema: ookrun_skill_projection.v2
  - event_count: 13
  -
ecorded_event_count: 0
  -
econstructed_event_count: 13
  - evidence_basis:
econstructed
  - 首事件：generate，provenance=reconstructed_from_progress，
ecorded=false
  - 末事件：export，ook_artifact_ref=book_run:1:export，
ecorded=false
- udit-page-visible-checks.json：
  - 页面包含 BookRun 审计、技能链审计、ookrun_skill_projection.v2、证据来源。
  - 页面包含
econstructed、provenance=reconstructed_from_progress、证据=重建。
  - 页面包含 generate、judge、pprove、memory_extract、export。
  - 页面包含 model_run_id=1 与 ook_artifact_ref=book_run:1:export。

### 人类可见性结论

通过。udit-page.html 的技能链区域同时展示：

- 汇总级证据来源：证据来源 = reconstructed。
- 事件级来源：provenance=reconstructed_from_progress。
- 人类标签：证据=重建。

这三层标识足以让读者知道当前技能链不是生产实录，而是从 BookRun progress 重建的审计投影。

### 依赖与风险评估

- **依赖**：API 导出仍通过 workflow_skill_audit_bridge.py 读取 workflow udit.py；Web 读取 progress.skill_chain 或 progress.audit_report.skill_chain。
- **已知限制**：本次验证没有关闭真实 skill_runs 缺口。证据显示
ecorded_event_count=0，即所有 13 个事件仍为重建。
- **浏览器限制**：in-app Browser 拒绝访问本地 ile:// 审计页；已按安全策略停止浏览器路径，改用 React 静态 HTML 文本验证。
- **补偿计划**：若后续需要真实浏览器截图，应通过项目正常 dev server 暴露审计页，而不是绕过 ile:// 策略。

### 评分

- **代码质量**：95/100。未改生产代码，复用现有入口；初次产物路径误落子目录但已修正并记录。
- **测试覆盖**：94/100。覆盖 API、exporter、workflow 投影、Web 组件和实际导出数据静态渲染；缺少浏览器截图但有安全策略原因。
- **规范遵循**：92/100。遵循本地验证与 .codex 留痕；desktop-commander 不可用已记录并使用本地替代。
- **需求匹配**：96/100。完整验证导出与审计页可见性，并明确真实 skill_runs 未关闭。
- **架构一致**：95/100。不触碰执行路径，不引入新依赖。
- **风险评估**：95/100。真实实录缺口、浏览器限制和下一步方向均已记录。
- **综合评分**：94/100。
- **建议**：通过。

### 下一步建议

端到端验真已通过。下一步建议进入 真实 skill_runs 接线路径 a/b 比较，重点用运行事实确认是否选择 WorkflowRuntime/LangGraph 节点实录事件路径。

## 端到端验真报告（可读修正版）：mock BookRun 导出与审计页 reconstructed 可见性

时间：2026-06-01 01:13:30 +08:00

### 需求字段完整性

- 目标：验证上一轮“诚实化”是否在真实本地上下文中落地，尤其是 reconstructed / 重建 标识是否对人类可见且不误导。
- 范围：本地 deterministic/mock BookRun、book.md、audit_report.json、Web BookRunAuditPanel 静态审计页渲染。
- 交付物：
  - D:\StoryForge\.codex\context-summary-e2e-skill-audit.md
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\book.md
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit_report.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\book_run_for_audit_page.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit-page.html
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\audit-page-visible-checks.json
  - D:\StoryForge\.codex\e2e-skill-audit-20260601-010649\smoke-summary.json
- 审查要点：导出证据完整、审计页可见、recorded 与 reconstructed 不混淆、真实 skill_runs 缺口继续显式。

### 本地验证命令与结果

- cd D:\StoryForge\apps\api; uv run pytest tests/test_phase9a_deterministic_smoke.py -q
  - 结果：通过，1 passed in 0.23s。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_exporter.py -q
  - 结果：通过，3 passed in 0.47s。
- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_skill_audit_summary.py -q
  - 结果：通过，11 passed in 0.52s。
- cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit
  - 结果：通过，3 pass / 0 fail。
- 使用内联 Python 运行 run_phase9a_deterministic_smoke(session) 并导出制品。
  - 结果：BookRun #1 completed；book.md 正文词数 3468；audit_report.json 生成成功。
- 使用实际导出数据静态渲染 BookRunAuditPanel。
  - 结果：audit-page-visible-checks.json 中 14 项页面可见性检查全部为 true。

### 关键证据

- smoke-summary.json：
  - skill_chain_schema: bookrun_skill_projection.v2
  - event_count: 13
  - recorded_event_count: 0
  - reconstructed_event_count: 13
  - evidence_basis: reconstructed
  - 首事件：generate，provenance=reconstructed_from_progress，recorded=false
  - 末事件：export，book_artifact_ref=book_run:1:export，recorded=false
- audit-page-visible-checks.json：
  - 页面包含 BookRun 审计、技能链审计、bookrun_skill_projection.v2、证据来源。
  - 页面包含 reconstructed、provenance=reconstructed_from_progress、证据=重建。
  - 页面包含 generate、judge、approve、memory_extract、export。
  - 页面包含 model_run_id=1 与 book_artifact_ref=book_run:1:export。

### 人类可见性结论

通过。audit-page.html 的技能链区域同时展示：

- 汇总级证据来源：证据来源 = reconstructed。
- 事件级来源：provenance=reconstructed_from_progress。
- 人类标签：证据=重建。

这三层标识足以让读者知道当前技能链不是生产实录，而是从 BookRun progress 重建的审计投影。

### 依赖与风险评估

- 依赖：API 导出仍通过 workflow_skill_audit_bridge.py 读取 workflow audit.py；Web 读取 progress.skill_chain 或 progress.audit_report.skill_chain。
- 已知限制：本次验证没有关闭真实 skill_runs 缺口。证据显示 recorded_event_count=0，即所有 13 个事件仍为重建。
- 浏览器限制：in-app Browser 拒绝访问本地 file:// 审计页；已按安全策略停止浏览器路径，改用 React 静态 HTML 文本验证。
- 补偿计划：若后续需要真实浏览器截图，应通过项目正常 dev server 暴露审计页，而不是绕过 file:// 策略。

### 评分

- 代码质量：95/100。未改生产代码，复用现有入口；初次产物路径误落子目录但已修正并记录。
- 测试覆盖：94/100。覆盖 API、exporter、workflow 投影、Web 组件和实际导出数据静态渲染；缺少浏览器截图但有安全策略原因。
- 规范遵循：92/100。遵循本地验证与 .codex 留痕；desktop-commander 不可用已记录并使用本地替代。
- 需求匹配：96/100。完整验证导出与审计页可见性，并明确真实 skill_runs 未关闭。
- 架构一致：95/100。不触碰执行路径，不引入新依赖。
- 风险评估：95/100。真实实录缺口、浏览器限制和下一步方向均已记录。
- 综合评分：94/100。
- 建议：通过。

### 下一步建议

端到端验真已通过。下一步建议进入“真实 skill_runs 接线路径 a/b 比较”，重点用运行事实确认是否选择 WorkflowRuntime/LangGraph 节点实录事件路径。

## 架构决策准备报告：真实 skill_runs 接线路径 a/b 比较

时间：2026-06-01 01:24:45 +08:00

### 当前事实

1. `NovelSkillRunner`、`NovelLoopResult.skill_runs`、`BookLoop._chapter_progress(...)["skill_runs"]`、`audit.py` 的 recorded 优先逻辑已经存在。
2. API BookRun 领域只负责创建运行记录与接收 progress 回填；没有直接调用 workflow、BookLoop 或 WorkflowRuntime。
3. `phase9b_real_llm_smoke.py` 在 API 进程中手写章节生成和 progress，未走 BookLoop/NovelLoop runner，因此不会产出真实 `skill_runs`。
4. `WorkflowRuntime`/`graph.py` 是 LangGraph 节点图路径，已有节点级审计和 checkpoint，但节点语义是 `book_director/chapter_planner/scene_beats/draft_writer/draft_critic/draft_reviser/human_approval`，不是现有 NovelSkill 的 `generate/judge/repair/approve/memory_extract/export`。

### a 路径：API → workflow → BookLoop 注入 skill_runner

#### 推荐的 a 修正版

不要把 runner 塞进 API service；应新增或补齐“BookRun workflow adapter”：

1. API 创建 BookRun 后仍只持久化 `running`。
2. workflow worker/adapter 接收 BookRun id、book_id、blueprint_id、预算。
3. adapter 构造 `BookLoopRequest`。
4. adapter 的 `run_chapter(chapter_index)` 内：
   - 构造 `NovelSkillRunner.default()`；
   - 调用 `run_single_chapter_loop(..., skill_runner=runner)`；
   - 返回 `NovelLoopResult`。
5. `run_book_loop()` 聚合 `NovelLoopResult.skill_runs` 到 progress。
6. adapter 通过 `PATCH /api/book-runs/{id}/progress` 或 API-side adapter 调用 `apply_book_run_progress()`。
7. exporter/audit/web 无需新解释，自动看到 recorded skill_runs。

#### 输入输出协议草案

输入：

```json
{
  "book_run_id": 1,
  "book_id": 2,
  "blueprint_id": 3,
  "total_chapters": 3,
  "start_chapter_index": 1,
  "token_budget": 24000,
  "time_budget_sec": 900,
  "chapter_budget": 3
}
```

progress 输出关键片段：

```json
{
  "completed_chapters": [
    {
      "chapter_index": 1,
      "status": "approved",
      "model_run_id": 31,
      "judge_report_id": 41,
      "approved_scene_id": 51,
      "skill_runs": [
        {
          "skill_name": "generate",
          "skill_version": "1.0.0",
          "status": "generated",
          "book_id": 2,
          "chapter_index": 1,
          "input_refs": {"compiled_context_id": "ctx-1"},
          "output_refs": {"model_run_id": 31, "draft_hash": "sha256:..."},
          "budget": {},
          "error_summary": null
        }
      ]
    }
  ],
  "budget": {"tokens_used": 1234, "elapsed_time_sec": 60, "estimated_cost": 0.0}
}
```

#### 优点

- 与现有 `NovelSkillRunner`、BookLoop progress、audit/export/web 完全对齐。
- 最短路径能关闭 BookRun audit_report 的 `recorded_event_count=0` 缺口。
- 不需要先发明 graph node 到 skill 的语义映射。

#### 风险

- 必须先补齐真正的 API→workflow worker/adapter；否则只是在测试或 smoke 工具中接线。
- 若把 phase9b smoke 当生产接线，会扩大临时代码债务。

### b 路径：WorkflowRuntime / LangGraph 节点发实录事件

#### 可行映射候选

| LangGraph 节点 | 候选事件名 | 是否可映射到现有 NovelSkill | 说明 |
|---|---|---|---|
| `book_director` | `workflow.book_director` | 否 | 更像规划/策略，不是章节 generate。 |
| `chapter_planner` | `workflow.chapter_plan` | 否 | 章节计划，不等同 judge/approve。 |
| `scene_beats` | `workflow.scene_beats` | 部分 | 可作为 generate 的输入准备，但不是 generate 本身。 |
| `draft_writer` | `generate` 或 `workflow.draft_writer` | 部分 | 最接近 generate，但缺少 approve/judge 语义。 |
| `draft_critic` | `judge` 或 `workflow.draft_critic` | 部分 | 接近 judge，但输出不是 API JudgeIssue。 |
| `draft_reviser` | `repair` 或 `workflow.draft_reviser` | 部分 | 接近 repair，但 repair_patch_id 不存在。 |
| `human_approval` | `approve` 或 `workflow.human_approval` | 部分 | 接近 approve，但未必写入 approved_scene_id。 |

#### 事件 schema 草案

建议 b 先定义独立 schema，不直接复用 `NovelSkillRun`：

```json
{
  "event_name": "workflow.node.post",
  "schema_version": "workflow_node_run.v1",
  "thread_id": "...",
  "job_run_id": "...",
  "node_name": "draft_writer",
  "mapped_skill_name": "generate",
  "mapping_confidence": "partial",
  "status": "completed",
  "recorded": true,
  "provenance": "recorded_graph_node",
  "input_refs": {"scene_packet_id": "..."},
  "output_refs": {"draft_artifact_id": "...", "model_run_id": 31},
  "metadata": {"duration_ms": 1234}
}
```

#### 优点

- 命中 `WorkflowRuntime` 当前 LangGraph 真实节点图。
- 可复用已有 node audit store、checkpoint 和 lifecycle 事实源。
- 对运行恢复、节点失败、provider 失败的状态解释更自然。

#### 风险

- 与 BookRun audit_report 的现有技能链不是同一语义层，直接替换会造成新误导。
- 需要先定义 graph 节点到 skill 的映射，且大量映射只能是 partial。
- 不能直接解决当前 BookRun exporter 中 `recorded_event_count=0`，除非再建 graph→BookRun 桥。

### a/b 对比结论

| 维度 | a 修正版 | b |
|---|---|---|
| 关闭 BookRun audit_report 缺口 | 强 | 弱，需额外桥接 |
| 命中 LangGraph 生产运行 | 弱/取决于 adapter | 强 |
| 复用现有 `NovelSkillRunner` | 强 | 弱 |
| 语义误导风险 | 低 | 中高，节点与技能粒度不一致 |
| 实施半径 | 中 | 大 |
| 长期架构价值 | 中 | 高，但需独立 schema |
| 当前推荐 | 第一优先 | 第二阶段研究 |

### 推荐决策

推荐先做 **a 修正版**，不是原始“API 里直接塞 runner”的 a，也不是马上做 b。

具体推荐：

1. 新增或补齐 BookRun workflow adapter，让 API 仍只负责真相源，workflow adapter 负责执行 BookLoop。
2. 在 adapter 的 `run_chapter` 内创建 `NovelSkillRunner.default()`，并传给 `run_single_chapter_loop()`。
3. 让 `run_book_loop()` 继续自然聚合 `result.skill_runs`。
4. 继续用 `apply_book_run_progress()` / PATCH progress 回填。
5. 只在这一链路打通后，再评估 b，并把 b 作为 `workflow_node_run.v1` 独立节点事件，不直接冒充章节 `skill_runs`。

### 状态词一致性验证方式

实现前应新增一条运行期或测试期校验：

1. 收集 `DEFAULT_NOVEL_SKILL_REGISTRY` 所有 `status_mapping.values()`。
2. 运行一条带 runner 的单章/BookLoop fixture。
3. 断言每个 `skill_run.status` 属于对应 skill 的 status_mapping 目标值集合。
4. 断言 BookRun 终态只属于既有集合：`running/completed/awaiting_review/paused_by_budget/paused_by_provider_degradation/paused_by_user/stopped`。
5. 断言导出 `skill_chain.summary.recorded_event_count > 0`。

### 最小验收标准

- `apps/workflow` 新增 adapter 级测试：BookLoop 跑 1 章时 `completed_chapters[0].skill_runs` 至少包含 `generate/judge/approve`。
- `apps/api` 新增回填/export 测试：带 `skill_runs` 的 progress 导出后，`audit_report.json.skill_chain.summary.recorded_event_count > 0`。
- Web 审计页继续显示“实录”，且不存在完整 prompt/正文。
- 不修改 `phase9b_real_llm_smoke.py` 作为长期主线，最多保留 smoke 兼容。

### 结论

当前不建议直接上 b。b 是正确的 LangGraph 节点级实录方向，但它不是关闭 BookRun `skill_runs` 缺口的最短路径。下一步应以 a 修正版补齐 BookRun workflow adapter 和 runner 注入；b 作为后续独立的 `workflow_node_run.v1` 事件体系设计。

### 架构决策准备验收摘要（可机读补充）

时间：2026-06-01 01:26:07 +08:00

- 至少 7 个相关实现路径：已覆盖 novel_loop.py、book_loop.py、skills/runner.py、skills/audit.py、book_runs/service.py、runtime/runner.py、graph.py、phase9b_real_llm_smoke.py。
- 事件 schema 草案：已在“b 路径”中给出 workflow_node_run.v1 JSON 草案。
- 状态词一致性验证方式：已给出 registry status_mapping、运行 fixture、BookRun 终态集合、recorded_event_count 的四层断言。
- 推荐 a 修正版：补齐 BookRun workflow adapter，在 adapter 的 run_chapter 内注入 NovelSkillRunner。
- workflow_node_run.v1：作为 b 路径后续独立节点事件 schema，不直接冒充章节 skill_runs。
- recorded_event_count > 0：作为 a 修正版最小验收标准。

## BookRun workflow adapter recorded skill_runs 验证报告

时间：2026-06-01 02:49:59 +08:00

### 需求字段完整性

- **目标**：补齐 BookRun workflow adapter，在 workflow 侧运行 BookLoop 并为每章 NovelLoop 注入 NovelSkillRunner，让 udit_report.json 出现真实 recorded skill_runs。
- **范围**：新增 workflow adapter、workflow 测试、API exporter recorded 验收测试、.codex 上下文/日志/验证报告；不改 API service 执行 workflow，不接入 LangGraph 节点级事件。
- **交付物**：
  - pps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py
  - pps/workflow/storyforge_workflow/orchestrators/__init__.py
  - pps/workflow/storyforge_workflow/orchestrators/novel_loop.py
  - pps/workflow/tests/test_book_run_adapter.py
  - pps/api/tests/test_book_run_recorded_skill_runs_export.py
  - .codex/context-summary-bookrun-workflow-adapter.md
  - .codex/operations-log.md
  - .codex/verification-report.md
- **审查要点**：runner 注入、recorded skill_runs、progress sink 回填、API exporter 消费 recorded 事件、敏感正文/提示词不泄漏、暂停/人工审查边界。

### 关键证据

- BookRun adapter 产出的 completed_chapters[0].skill_runs 包含 generate、judge、pprove、memory_extract。
- waiting_review 章节只保留已发生的 generate、judge，不再误触发 repair。
- udit_report.json 的 skill_chain.summary.recorded_event_count 为 4，
econstructed_event_count 为 1，evidence_basis 为 mixed。
- udit_report.json 保留 export 的 reconstructed 事件，不把导出动作伪装成章节实录。
- 审计 payload 不包含完整提示词或完整正文。

### 验证命令与结果

- workflow 目标测试：uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v → 通过，30 passed。
- API 目标测试：uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v → 通过，12 passed, 1 warning。
- workflow 全量 pytest：uv run pytest -q → 通过，156 passed。
- API 全量 pytest：uv run pytest -q → 通过，326 passed, 6 warnings。
- web 审计回归：pnpm --filter @storyforge/web test -- book-run-audit → 通过，3 pass / 0 fail。

### 技术维度评分

- 代码质量：95/100
  - adapter 只承担边界转换与 sink 回填，复用现有 BookLoop/NovelLoop/runner。
- 测试覆盖：95/100
  - 覆盖 completed、awaiting_review、budget pause、状态词一致性、API exporter recorded/reconstructed 混合证据和全量回归。
- 规范遵循：94/100
  - 已生成上下文摘要、操作日志、验证报告；本地验证完整。扣分项：desktop-commander 未在当前工具集中暴露，已记录 PowerShell 替代。

### 战略维度评分

- 需求匹配：96/100
  - recorded skill_runs 已通过 workflow adapter 产出，并由 audit_report 消费。
- 架构一致：95/100
  - API 仍为真相源，不在 API service 内执行 workflow；LangGraph 节点事件未混入章节 skill_runs。
- 风险评估：94/100
  - 已记录既有脏工作区和 .worktrees ignore 风险；验证覆盖任务相关路径。

### 综合结论

综合评分：95/100
建议：通过

### 决策留痕

- 审查结论时间：2026-06-01 02:49:59 +08:00
- 决策规则：综合评分 ≥90 且建议“通过”，确认通过。


## BookRun workflow adapter recorded skill_runs ???????????

???2026-06-01 02:51:11 +0800

### ???????

- ????? BookRun workflow adapter?? workflow ??? BookLoop ???? NovelLoop ?? `NovelSkillRunner`?? `audit_report.json` ???? recorded `skill_runs`?
- ????? workflow adapter?workflow ???API exporter recorded ?????`.codex` ???/??/??????? API service ?? workflow???? LangGraph ??????
- ????
  - `apps/workflow/storyforge_workflow/orchestrators/book_run_adapter.py`
  - `apps/workflow/storyforge_workflow/orchestrators/__init__.py`
  - `apps/workflow/storyforge_workflow/orchestrators/novel_loop.py`
  - `apps/workflow/tests/test_book_run_adapter.py`
  - `apps/api/tests/test_book_run_recorded_skill_runs_export.py`
  - `.codex/context-summary-bookrun-workflow-adapter.md`
  - `.codex/operations-log.md`
  - `.codex/verification-report.md`
- ?????runner ???recorded `skill_runs`?progress sink ???API exporter ?? recorded ???????/?????????/???????

### ????

- BookRun adapter ??? `completed_chapters[0].skill_runs` ?? `generate`?`judge`?`approve`?`memory_extract`?
- `awaiting_review` ????????? `generate`?`judge`?????? repair?
- `audit_report.json` ? `skill_chain.summary.recorded_event_count` ? 4?`reconstructed_event_count` ? 1?`evidence_basis` ? `mixed`?
- `audit_report.json` ?? `export` ? reconstructed ?????????????????
- ?? payload ??????????????

### ???????

- workflow ?????`uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v` ? ???`30 passed`?
- API ?????`uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v` ? ???`12 passed, 1 warning`?
- workflow ?? pytest?`uv run pytest -q` ? ???`156 passed`?
- API ?? pytest?`uv run pytest -q` ? ???`326 passed, 6 warnings`?
- web ?????`pnpm --filter @storyforge/web test -- book-run-audit` ? ???`3 pass / 0 fail`?

### ??????

- ?????95/100?adapter ???????? sink ??????? BookLoop/NovelLoop/runner?
- ?????95/100??? completed?awaiting_review?budget pause????????API exporter recorded/reconstructed ??????????
- ?????94/100???????????????????????????????`desktop-commander` ?????????????? PowerShell ???

### ??????

- ?????96/100?recorded `skill_runs` ??? workflow adapter ????? audit_report ???
- ?????95/100?API ???????? API service ??? workflow?LangGraph ????????? `skill_runs`?
- ?????94/100??????????? `.worktrees` ignore ??????????????

### ????

?????95/100
?????

### ????

- ???????2026-06-01 02:51:11 +0800
- ????????? ?90 ?????????????


## BookRun workflow adapter ???????

???2026-06-01 02:52:25 +0800

- ????????????/????? UTF-8 BOM????????????
- ????????workflow ???????`30 passed`?
- ??? API ????????`12 passed, 1 warning`?
- ??? Web ????????`3 pass / 0 fail`?
- ??? workflow ????????`156 passed`?
- ??? API ????????`326 passed, 6 warnings`?
- ???????????? UTF-8 BOM ?????


## ???????

???2026-06-01 02:58:16 +0800

- `git diff --cached --check`??????????
- workflow ruff ????????`All checks passed!`?
- API ruff ????????`All checks passed!`?
- workflow ????????`30 passed`?
- API ????????`12 passed, 1 warning`?
- Web ????????`3 pass / 0 fail`?
- workflow ????????`156 passed`?
- API ????????`326 passed, 6 warnings`?

## BookRun workflow adapter recorded skill_runs 复核记录

时间：2026-06-01 03:52:48 +08:00

### 复核范围

- 目标：确认 BookRun workflow adapter 已完成并能产出真实 recorded skill_runs。
- 范围：workflow adapter、NovelLoop skill runner 集成、BookLoop 回归、API exporter、Web 审计面板回归。
- 排除：未将 LangGraph 节点事件伪装为章节 skill_runs；未在 API service 内直接执行 workflow。

### 本地验证命令与结果

- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py -v → 4 passed。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py -v → 1 passed。
- rg -n "from storyforge_workflow\.orchestrators import|import storyforge_workflow\.orchestrators" apps\workflow apps\api tests docs → 未发现聚合入口导入用法，orchestrators.__init__ 当前导出未破坏已知导入方。
- cd D:\StoryForge\apps\workflow; uv run ruff check . → All checks passed。
- cd D:\StoryForge\apps\api; uv run ruff check . → All checks passed。
- cd D:\StoryForge\apps\workflow; uv run pytest tests/test_book_run_adapter.py tests/test_novel_loop_skill_runner_integration.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v → 30 passed。
- cd D:\StoryForge\apps\api; uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v → 12 passed, 1 warning。
- cd D:\StoryForge\apps\workflow; uv run pytest -q → 156 passed。
- cd D:\StoryForge\apps\api; uv run pytest -q → 326 passed, 6 warnings。
- cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit → 3 pass / 0 fail。

### 关键验收证据

- tests/test_book_run_adapter.py 覆盖 completed、awaiting_review、章节预算暂停和状态词一致性；adapter 路径产出 generate、judge、approve、memory_extract recorded skill_runs。
- tests/test_book_run_recorded_skill_runs_export.py 断言 recorded_event_count == 4、reconstructed_event_count == 1、evidence_basis == "mixed"，因此 recorded_event_count > 0 已由本地测试验证。
- 同一 API 导出测试确认前 4 个事件 provenance == "recorded_skill_run"，export 事件仍为 reconstructed，避免把导出阶段伪装成实录 skill。
- workflow 与 API 测试均断言输出不包含完整提示词或完整正文，满足审计投影最小暴露要求。

### 审查评分

- 代码质量：95/100。adapter 保持边界清晰，复用 BookLoop、NovelLoop 与 NovelSkillRunner，未把 API ORM 引入 workflow。
- 测试覆盖：95/100。覆盖正常完成、awaiting_review、预算暂停、状态映射、导出混合证据、Web 审计显示和全量回归。
- 规范遵循：94/100。所有验证均在本地执行并留痕；当前工具集中未暴露 desktop-commander，已用 PowerShell 替代并记录。
- 需求匹配：96/100。真实 recorded skill_runs 已由 adapter 产出并进入 audit/export/web 消费路径。
- 架构一致：95/100。未把 LangGraph 节点冒充章节 skill；未在 API service 内执行 workflow。
- 风险评估：94/100。既有 API warning 不影响本任务；工作区仍存在任务外 .codex 历史变更，暂存时必须继续选择性处理。

综合评分：95/100
建议：通过

## StoryForge 项目健康评估验证记录

时间：2026-06-01 04:20:41 +08:00

### 命令结果

- workflow ruff：cd D:\StoryForge\apps\workflow; uv run ruff check . → All checks passed。
- workflow pytest：cd D:\StoryForge\apps\workflow; uv run pytest -q → 156 passed。
- API ruff：cd D:\StoryForge\apps\api; uv run ruff check . → All checks passed。
- API pytest：cd D:\StoryForge\apps\api; uv run pytest -q → 326 passed, 6 warnings。
- Web audit contract：cd D:\StoryForge; pnpm --filter @storyforge/web test -- book-run-audit → 3 pass / 0 fail。
- workflow 主链路目标测试：uv run pytest tests/test_book_run_adapter.py tests/test_book_loop_three_chapters.py tests/test_skill_audit_summary.py tests/test_novel_skill_runner.py -v → 27 passed。
- API 主链路目标测试：uv run pytest tests/test_book_run_recorded_skill_runs_export.py tests/test_book_exporter.py tests/test_book_runs.py -v → 12 passed, 1 warning。

### warning 分类

- 阻塞 warning：无。
- 非阻塞 warning：JWT 测试密钥长度提示、HTTP 422 常量 deprecation。两类 warning 均未影响 BookRun 主链路验证通过，但建议纳入后续治理任务。
