# StoryForge 项目剪枝与完善子代理协作总控文档

生成时间：2026-06-03 16:42:09 +08:00
项目根目录：`D:\StoryForge`
主上下文摘要：`D:\StoryForge\.codex\context-summary-项目剪枝完善.md`

> 本文档用于降低后续剪枝/完善工作的上下文消耗，并把工作拆成可分发给子代理的任务卡。

## 0. 使用方式

子代理启动时只读取本文档、相关任务卡列出的路径，以及必要时读取 `.codex/context-summary-项目剪枝完善.md`。不要读取整个 `.codex/`，不要粘贴长源码、长日志、完整 OpenAPI 或大型运行产物。

## 1. 总目标

- 剪枝：清理缓存、临时产物、重复记录、过期补丁和无效制品。
- 完善：补齐事实源索引、验证入口、契约边界、运行证据和可维护性说明。
- 保护：不破坏 API/Web/Workflow/Shared 的测试、路由、契约和真实 LLM 能力边界。
- 降上下文：所有发现写成路径索引、证据摘要和任务卡。

## 2. 硬性规则

- 全部回复、文档、注释、日志、提交信息必须使用简体中文；代码标识符保留项目既有风格。
- 先只读扫描，再给建议；删除、移动、重构前必须列出证据和回滚方案。
- 不得覆盖用户已有未提交改动。
- 不得删除真实 LLM、BookRun、审计、OpenAPI 或 E2E 相关证据，除非证明已有替代归档。
- 不得宣称远程 CI 或人工验证；所有结论必须来自本地命令、文件证据或明确标记为待验证。

## 3. 当前项目事实索引

| 区域 | 事实源 | 说明 |
|---|---|---|
| 总说明 | `D:\StoryForge\README.md` | 当前能力边界、运行方式、发布前门禁 |
| 当前阶段 | `D:\StoryForge\current-phase.md` | 阶段状态与任务事实源 |
| API | `D:\StoryForge\apps\api` | FastAPI、数据库、BookRun、Provider、检索、评测等业务真相源 |
| Web | `D:\StoryForge\apps\web` | Next.js App Router 页面与本地 API 访问边界 |
| Workflow | `D:\StoryForge\apps\workflow` | LangGraph/工作流运行态、技能、质量控制与模型调用边界 |
| Shared | `D:\StoryForge\packages\shared` | OpenAPI 契约与生成类型 |
| 架构文档 | `D:\StoryForge\docs\architecture` | 工作台、上下文记忆、ModelRun 适配契约 |
| 本地记录 | `D:\StoryForge\.codex` | 上下文摘要、验证报告、截图、运行制品、临时文件 |

## 4. 工作树保护提示

启动任务前必须运行：

```powershell
git status --short
```

如果要修改文件，必须声明计划修改文件、文件当前状态，以及如何避免覆盖他人改动。

## 5. 子代理通用输出格式

```markdown
## 子代理结果：[任务名]

### 结论
- [保留/删除/归档/完善/暂缓]：一句话结论。

### 证据
- `路径1`：关键事实，不超过两行。
- `路径2`：关键事实，不超过两行。

### 建议动作
1. 动作：...
   - 影响范围：...
   - 回滚方式：...
   - 本地验证：...

### 风险
- 风险：...
- 缓解：...

### 回填
- 建议写入：`D:\StoryForge\.codex\project-pruning-and-improvement-dispatch.md` 的哪个小节。
```

## 6. 子代理任务卡

### 任务卡 A：`.codex` 本地制品剪枝清单

- 目标：区分 `.codex` 中应保留的上下文摘要/验证报告与可归档或删除的临时制品。
- 输入路径：`D:\StoryForge\.codex`
- 禁止：不要读取大型 `book.md`、`.sqlite`、浏览器缓存内容；只统计路径、大小、时间。
- 重点候选：`tmp/` 浏览器 profile、`uiux-*.png`、`*.log`、`*smoke*.sqlite*`、`real-llm-*`。
- 输出：保留/归档/删除三列表，附路径模式和理由。
- 验证：删除前先生成 dry-run 清单；真实删除另开任务执行。

### 任务卡 B：根目录补丁、阶段文档与状态文件整理

- 目标：判断根目录 `.patch`、阶段文档、历史计划是否需要归档。
- 输入路径：`.codex-fix-phase9b-*.patch`、`.dev_plan.md`、`current-phase.md`、`TODO.md`、`PROJECT_SUMMARY.md`。
- 禁止：不要改写当前事实源；只提出整理方案。
- 输出：每个文件的“保留在根目录/移动归档/合并进现有文档/待人工确认”建议。

### 任务卡 C：API 模块复杂度与死代码候选扫描

- 目标：识别 `apps/api` 中职责过重、重复、疑似废弃的模块；不直接删代码。
- 输入路径：`D:\StoryForge\apps\api\app`、`D:\StoryForge\apps\api\tests`。
- 排除：`.venv`、`.pytest_cache`、`.ruff_cache`、`__pycache__`。
- 输出：最多 10 个候选，每个候选必须有测试覆盖路径或缺失测试风险。
- 验证建议：`cd apps/api && uv run pytest <相关测试>`。

### 任务卡 D：Workflow 编排与技能层整理

- 目标：梳理 `apps/workflow/storyforge_workflow` 中 orchestrators、skills、quality、runtime 的边界。
- 输入路径：`D:\StoryForge\apps\workflow\storyforge_workflow`、`D:\StoryForge\apps\workflow\tests`。
- 禁止：不要更改真实模型调用边界与 provider 降级逻辑。
- 输出：边界图、重复职责候选、缺失测试候选。
- 验证建议：`cd apps/workflow && uv run pytest <相关测试>`。

### 任务卡 E：Web App Router 页面与组件清理

- 目标：识别 `apps/web` 中重复页面壳、未使用组件、过期截图驱动样式和可抽取布局。
- 输入路径：`apps/web/app`、`apps/web/components`、`apps/web/lib`、`apps/web/tests`。
- 保护：`page.tsx`、`layout.tsx`、`route.ts` 是 Next.js App Router 契约文件，不得仅凭“无 import”判定删除。
- 输出：页面/组件/库函数三类候选，附使用证据。
- 验证建议：`pnpm run test:web`，必要时用浏览器读取关键页面。

### 任务卡 F：共享契约与生成文件治理

- 目标：确认 `packages/shared` 中契约和生成类型的来源、更新命令、可否剪枝。
- 输入路径：`packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`、`scripts/generate-openapi.mjs`。
- 禁止：不要手改生成文件作为长期方案。
- 输出：生成链路说明、可剪枝项、必须保留项。
- 验证建议：`pnpm run openapi`，如有 diff 必须解释来源。

### 任务卡 G：验证体系与命令收敛

- 目标：整理现有验证入口，给出“快速/标准/发布前”三档本地验证矩阵。
- 输入路径：`package.json`、`scripts`、`apps/api/pyproject.toml`、`apps/workflow/pyproject.toml`、`README.md`。
- 输出：验证矩阵和失败时停止规则。
- 验证：至少运行只读命令检查脚本存在性，不强制跑全量测试。

### 任务卡 H：文档事实源去重

- 目标：找出 README、current-phase、PROJECT_SUMMARY、AI_ITERATION_GUIDE、MODULE_ISOLATION_SCORECARD、docs/architecture 之间的重复与冲突。
- 输入路径：`README.md`、`current-phase.md`、`PROJECT_SUMMARY.md`、`AI_ITERATION_GUIDE.md`、`MODULE_ISOLATION_SCORECARD.md`、`docs`。
- 输出：唯一事实源建议，不复制大段内容。
- 验证：所有冲突必须按“README/current-phase/运行证据优先”的顺序处理。

## 7. 剪枝执行分级

| 等级 | 含义 | 示例 | 是否可自动执行 |
|---|---|---|---|
| P0 | 明确缓存/临时文件 | `.next`、`.pytest_cache`、浏览器 Cache | 可 dry-run，执行前仍需确认 |
| P1 | 本地验证制品 | `.codex/*.png`、`.codex/*.log`、`.sqlite` | 建议先归档后删除 |
| P2 | 历史文档/补丁 | 根目录 `.patch`、旧计划 | 需确认是否仍用于审计 |
| P3 | 源码疑似死代码 | 未引用模块、重复服务 | 必须有测试与回滚，不自动删除 |
| P4 | 架构重构 | API/Workflow/Web 边界调整 | 另开设计与实现任务 |

## 8. 完善方向优先级

1. 先建立验证矩阵和事实源索引。
2. 再做 `.codex` 与缓存制品 dry-run 清单。
3. 再整理根目录历史补丁与阶段文档。
4. 再进入 API/Workflow/Web 源码级剪枝建议。
5. 最后做跨模块重构设计，不在剪枝首轮直接实施。

## 9. 本地验证矩阵草案

| 场景 | 命令 | 用途 |
|---|---|---|
| 快速结构检查 | `git status --short` | 确认未提交改动与保护范围 |
| 总验证 | `pnpm run verify` | 项目主验证入口 |
| API 单层 | `cd apps/api && uv run pytest` | API 全量测试 |
| Workflow 单层 | `cd apps/workflow && uv run pytest` | 工作流全量测试 |
| Web/Shared | `pnpm run test:web` | Web 与共享包测试 |
| E2E | `pnpm run e2e` | 本地端到端链路 |
| 契约 | `pnpm run openapi` | OpenAPI 与生成类型同步 |
| 格式/静态检查 | `pnpm run lint` | ESLint、Prettier 检查 |

## 10. 回填协议

子代理完成后，不要直接大段改写本文档。优先在回复中给出“建议回填小节”。由主代理统一追加到以下区域：

- `## 11. 已确认保留清单`
- `## 12. 已确认归档/删除候选`
- `## 13. 已确认完善任务`
- `## 14. 风险与阻塞`

## 11. 已确认保留清单

- `D:\StoryForge\README.md`：当前能力边界与本地运行入口。
- `D:\StoryForge\current-phase.md`：当前阶段事实源。
- `D:\StoryForge\packages\shared\src\contracts\storyforge.openapi.json`：共享契约，不能手动剪枝。
- `D:\StoryForge\packages\shared\src\generated\api-types.ts`：生成类型，不能手动剪枝。

## 12. 已确认归档/删除候选

待子代理 A/B dry-run 后回填。

## 13. 已确认完善任务

- 建立三档本地验证矩阵，并同步到合适的事实源文档。
- 为 `.codex` 本地制品制定归档策略，避免根目录与上下文目录持续膨胀。
- 为源码级剪枝先产出候选报告，不直接删除。

## 14. 风险与阻塞

- 当前有既有未提交改动；任何后续修改都必须先确认文件归属。
- `.codex/operations-log.md` 已较大，后续仅追加摘要和索引。
- `D:\StoryForge\apps\workflow\.pytest-tmp` 扫描时出现权限拒绝，按临时目录处理并排除；如后续需要清理，必须先确认进程未占用。

## 15. 给子代理的最短启动提示词

```text
你是 StoryForge 剪枝完善子代理。只读取 D:\StoryForge\.codex\project-pruning-and-improvement-dispatch.md 和与你任务卡相关的路径。先只读扫描，不删除、不移动、不改业务代码。输出必须使用文档第 5 节格式，证据用路径索引，不粘贴长源码或长日志。必须保护未提交改动、Next.js App Router 路由契约、OpenAPI 生成契约和真实 LLM 能力边界。
```
## 16. 待更新暂存区

> 后续用户补充、子代理结果、待确认剪枝项和验证待办先放在这里；主代理定期整理到第 11-14 节，避免主上下文膨胀。

### 16.1 用户补充

- 2026-06-03 16:54:26 +08:00：后续还要完善和改良工作流；范围先按待澄清记录，可能包含创作运行工作流与工程协作工作流。

### 16.2 子代理结果待整理

- 待分发：创作运行工作流完善分析，关注 apps/workflow 编排边界、失败恢复、checkpoint、质量门禁和真实模型调用边界。
- 待分发：工程协作工作流改良分析，关注 .codex 回填协议、子代理任务卡、验证矩阵、日志瘦身和交付门禁。

### 16.3 待确认剪枝项

- 暂无。

### 16.4 待补验证

- 工作流完善改良进入实施前，需要先补一份范围确认与本地验证矩阵，避免混淆业务运行工作流和工程协作流程。