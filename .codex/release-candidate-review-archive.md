# 第九阶段发布候选审查与归档

生成时间：2026-05-25 15:48:53 +08:00

## 1. 审查结论

- 综合评分：92/100。
- 建议：通过，但提交前需人工确认两个归档偏差。
- 决策：当前 diff 可作为 Runtime 诊断治理发布候选审阅范围；本阶段未自动提交、未创建 PR、未删除任何文件。
- 明确未做：未新增业务功能、未新增 runtime 抽象、未接 MCP、未做插件动态安装、未引入 `C:\Users\kanye\claw-code` Rust 代码。

## 2. 必核证据读取结果

| 证据 | 结果 | 说明 |
| --- | --- | --- |
| `D:\StoryForge\.codex\runtime-diagnostics-release-candidate.md` | 缺失 | 根目录未找到；仓库内对应证据为 `D:\StoryForge\1-renovel-ai-ai-rag-tavern\.codex\release-candidate-report.md`。 |
| `D:\StoryForge\.codex\verification-report.md` | 已读取 | 根目录报告停留在早期阶段；仓库内最新报告已补充读取。 |
| `D:\StoryForge\.codex\operations-log.md` | 已读取 | 根目录日志停留在早期阶段；仓库内最新日志已补充读取。 |
| `D:\StoryForge\.codex\context-summary-code-inspection.md` | 已读取 | 记录代码深度检查与 claw-code 借鉴边界。 |
| `D:\StoryForge\.codex\storyforge-agent-runtime-absorption-plan.md` | 已读取 | 记录内部吸收、不跨语言嵌入、不优先 MCP 的架构计划。 |

## 3. 阶段 1-8 最终证据汇总

- 阶段 1：`WorkflowSession` 与 `WorkflowLifecycle` 已落地，验证记录显示 `test_workflow_session.py`、`test_workflow_lifecycle.py` 和 runtime runner 组合测试通过。
- 阶段 2：`ProviderAdapter` 与 mock provider parity harness 已进入 workflow 测试链路，未接入外部 Rust 子进程。
- 阶段 3：`CreativeToolRegistry` 成为 workflow 侧工具单一事实源，并具备重复工具名失败测试。
- 阶段 4：API/Web 可见性通过 `runtime_tools` 与 `/runs` 页面接入，Web 不维护静态工具清单。
- 阶段 5：Runtime diagnostics e2e 覆盖 OpenAPI、API、Web 与门禁脚本一致性。
- 阶段 6：`scripts/run-e2e.mjs` 与 `scripts/verify-local.ps1` 已纳入 Runtime 诊断门禁。
- 阶段 7：OpenAPI Runtime 契约治理纳入 shared 快照、e2e 与 verify 门禁。
- 阶段 8：发布候选冻结报告显示 `pnpm verify`、`pnpm e2e`、`pnpm test`、Web `tsc --noEmit`、`git diff --check` 均通过；`git diff --check` 仅有 CRLF 替换警告。

## 4. git diff 分类

- 仓库位置：`D:\StoryForge\1-renovel-ai-ai-rag-tavern`。
- 分支状态：`master...origin/master`，无 staged diff。
- 已跟踪修改：16 个文件。
- 未跟踪路径：21 个。
- diff 规模：16 个已跟踪文件，`2218 insertions(+), 83 deletions(-)`；未跟踪文件未计入该 stat。

### 4.1 预期 Runtime 诊断治理改动

- Workflow runtime：`apps/workflow/storyforge_workflow/runtime/__init__.py`、`provider_execution.py`、`runner.py`、新增 `session.py`、`lifecycle.py`、`provider_adapter.py`。
- Workflow 工具注册：新增 `apps/workflow/storyforge_workflow/tools/`。
- API 读侧：`apps/api/app/domains/model_runs/` 修改，新增 `apps/api/app/domains/runtime_tools/`，`apps/api/app/main.py` 注册路由。
- Web 展示：`apps/web/app/runs/page.tsx` 与相关 Web 静态测试。
- 契约与门禁：`packages/shared/src/contracts/storyforge.openapi.json`、`scripts/run-e2e.mjs`、`scripts/verify-local.ps1`、`tests/e2e/phase4-contract.spec.ts`、新增 `tests/e2e/phase5-runtime-diagnostics.spec.ts`。
- 测试：API、workflow、provider、tool registry、e2e 相关测试均属于 Runtime 诊断治理验证面。
- 归档：`.codex/` 下阶段上下文、操作日志、验证报告、发布候选报告属于审查证据。

### 4.2 需人工确认但不删除的项

- `apps/workflow/.codex/`：属于阶段执行日志与报告，但位置在 workflow 子目录，不是项目根 `.codex/`；建议提交前决定是否保留、移动或加入忽略规则。本阶段按用户要求只记录，不删除。
- `D:\StoryForge\.codex\runtime-diagnostics-release-candidate.md`：用户指定文件缺失；仓库内 `release-candidate-report.md` 内容等价于第八阶段冻结报告。建议提交前统一命名或在交付说明中解释。

## 5. 重复工具清单与禁止项核验

- 工具注册表探针命令：`uv run python -` 导入 `storyforge_workflow.tools.registry.list_creative_tools()`。
- 结果：`tool_count=7`，`duplicate_count=0`。
- 工具名称：`retrieval.search`、`scene_packets.assemble`、`judge.create_issues`、`repair.create_patch`、`artifacts.create`、`evaluations.create_run`、`provider_gateway.resolve`。
- 关键词搜索结论：`DEFAULT_CREATIVE_TOOL_REGISTRY` 只出现在 workflow 注册表、workflow 测试、Web/e2e 的禁止硬编码断言与文档中；Web 静态清单关键词 `runtimeToolList = [`、`runtimeDiagnosticTools = [` 仅作为禁止断言出现。
- 禁止项结论：未发现 MCP 桥接实现、插件动态安装实现或 `C:\Users\kanye\claw-code` Rust 代码引入；相关词仅在文档/报告中作为边界说明出现。

## 6. 无关文件审查结论

- 未发现 package 管理、Cargo/Rust、MCP、插件动态安装、业务新功能等无关改动。
- 当前全部已跟踪修改与未跟踪新增均可解释为 Runtime 诊断治理、OpenAPI 契约治理、API/Web/e2e/门禁和 `.codex` 证据文件。
- 唯一需确认的是 `apps/workflow/.codex/` 的归档位置偏离项目根 `.codex/` 约定。

## 7. 本地验证步骤与结果

| 命令 | 结果 |
| --- | --- |
| `git status --short --branch` | 通过，确认 16 个已跟踪修改与 21 个未跟踪路径。 |
| `git diff --name-status` | 通过，已跟踪 diff 均集中在 Runtime/API/Web/e2e/门禁/报告。 |
| `git diff --stat` | 通过，16 个已跟踪文件共 2218 行新增、83 行删除。 |
| `git diff --cached --name-status` | 通过，无 staged diff。 |
| `git diff --check` | 通过，仅 LF/CRLF 替换警告，无 whitespace error。 |
| `uv run python -` 工具注册表探针 | 通过，7 个工具、0 个重复名称。 |
| `rg` 禁止项与静态清单关键词搜索 | 通过，命中均为单一事实源、测试断言或文档边界说明。 |

## 8. 最终审查评分

- 代码质量：93/100。分层清晰，runtime/API/Web/e2e/门禁边界一致。
- 测试覆盖：94/100。阶段八已有全量本地验证，本阶段补充只读 diff、重复清单和禁止项验证。
- 规范遵循：90/100。简体中文文档齐全；扣分项为用户指定根目录冻结文件缺失、`apps/workflow/.codex/` 位置需确认。
- 战略一致：92/100。仍保持内部吸收策略，不引入 Rust/MCP/动态插件。
- 综合评分：92/100。
- 明确建议：通过，带两个提交前确认项。

## 9. commit message 草案

```text
完善 Runtime 诊断治理发布候选

- 增加 workflow session、lifecycle、provider adapter 与工具注册治理
- 增加 Runtime Tools API、ModelRun runtime diagnostics 读侧与 Runs 页面展示
- 刷新 OpenAPI 契约并补充 e2e、API、workflow、Web 与 verify 门禁
- 归档发布候选冻结、diff 审查和本地验证证据
```

## 10. PR 描述草案

### 背景

本 PR 汇总 Runtime 诊断治理阶段 1-8 的发布候选改动，使 workflow runtime 状态、provider 执行、工具事实源、API 读侧、Runs 页面、OpenAPI 契约与本地门禁形成闭环。

### 主要改动

- Workflow：新增会话、生命周期、provider adapter、provider parity harness 与创作工具注册表。
- API：新增 `/api/runtime-tools`，扩展 `/api/model-runs/job-runs/{job_run_id}` 的 `runtime_diagnostics`。
- Web：`/runs` 页面读取真实 API 与 runtime tools，不维护静态工具清单。
- 契约：刷新 shared OpenAPI，新增 Runtime/OpenAPI 一致性 e2e。
- 门禁：`pnpm verify` 与 `pnpm e2e` 纳入 Runtime 诊断和 OpenAPI Runtime 契约检查。
- 文档：补充上下文摘要、操作日志、验证报告、发布候选报告和第九阶段审查归档。

### 验证

- `node scripts/run-e2e.mjs tests/e2e/phase5-runtime-diagnostics.spec.ts`
- `pnpm verify`
- `pnpm e2e`
- `pnpm test`
- `pnpm --filter @storyforge/web exec tsc --noEmit`
- `git diff --check`
- `uv run python -` 工具注册表探针：7 个工具，0 个重复名称。

### 风险与注意事项

- `pnpm verify` 依赖 Docker daemon 以及 postgres、redis、minio 容器。
- `git diff --check` 存在 LF/CRLF 替换提示，但无 whitespace error。
- 提交前需确认 `apps/workflow/.codex/` 是否保留在子目录。
- 提交前需确认第八阶段冻结报告文件名是否统一为用户指定的 `runtime-diagnostics-release-candidate.md`。

## 11. 回滚策略

1. 若发布候选整体需撤回：执行 `git restore` 回滚已跟踪文件，并删除本次未跟踪新增路径。
2. 若只撤回 Web/API 诊断读侧：回滚 `apps/api/app/domains/model_runs/`、`apps/api/app/domains/runtime_tools/`、`apps/web/app/runs/page.tsx`、OpenAPI 快照和相关测试。
3. 若只撤回 workflow runtime 治理：回滚 `apps/workflow/storyforge_workflow/runtime/` 新增/修改文件、`apps/workflow/storyforge_workflow/tools/` 和 workflow 测试。
4. 每次回滚后必须重新执行 `pnpm openapi`、`pnpm verify`、`pnpm e2e`、`pnpm test` 与 `git diff --check`。
5. 回滚过程中不得删除未确认的用户文件；对不属于本 RC 的文件只记录并交由人工确认。
