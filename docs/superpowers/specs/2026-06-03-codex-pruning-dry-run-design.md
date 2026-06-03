# StoryForge 仓库瘦身 Dry-run 设计方案

生成时间：2026-06-03 20:05:00 +08:00

## 1. 背景与目标

StoryForge 当前已经积累了大量本地验证制品、截图、日志、真实 LLM 冒烟证据、上下文摘要和历史计划。它们对审计和迭代很有价值，但也会让 `.codex/` 与工作区持续膨胀，增加后续代理读取上下文、判断文件归属和提交变更的成本。

本轮目标是先生成一份保守 dry-run 清单，只做扫描、分类和建议，不删除、不移动、不改写任何业务文件。报告应回答：

1. 哪些文件必须保留，避免破坏当前事实源、真实 LLM 证据和生成契约。
2. 哪些文件建议归档，适合移动到后续归档目录但暂不删除。
3. 哪些文件可删除，属于明确缓存、临时日志或可重复生成制品。
4. 哪些文件需要人工确认，不能由自动规则直接处理。

## 2. 非目标

- 不实际删除文件。
- 不实际移动文件。
- 不重构 `apps/`、`packages/`、`docs/` 中的业务代码。
- 不清理未提交改动。
- 不把真实 LLM 证据、OpenAPI 生成物或审计报告当作普通缓存处理。
- 不运行全量测试作为扫描前置条件；本轮只验证报告生成逻辑和文件分类完整性。

## 3. 范围

### 3.1 主要扫描范围

- `D:\StoryForge\.codex`
- `D:\StoryForge\apps`
- `D:\StoryForge\packages`
- `D:\StoryForge\docs`
- `D:\StoryForge\scripts`
- 根目录常见缓存、日志、补丁和状态文件

### 3.2 明确排除读取深挖

以下路径只统计路径、大小、时间和文件类型，不读取正文：

- `*.sqlite`
- `*.db`
- `*.png`
- `*.jpg`
- `*.jpeg`
- `*.webp`
- `*.log`
- `packages/shared/src/contracts/storyforge.openapi.json`
- `packages/shared/src/generated/api-types.ts`
- `.codex/real-llm-*`
- `.codex/current-novel-smoke`
- `.codex/deterministic-10ch-short-story`

## 4. 输出文件

本轮生成：

- `D:\StoryForge\.codex\pruning-dry-run-report.md`

报告必须包含：

- 扫描时间、当前分支、最近提交、工作树摘要。
- 工具缺失说明和替代工具说明。
- 总体统计：文件数量、目录数量、总大小、Top 大文件、Top 新近制品。
- 四类清单：必须保留、建议归档、可删除、需人工确认。
- 每条建议的依据、影响范围、回滚方式和本地验证建议。
- 下一步执行选项：只归档、只删除明确缓存、先人工审阅。

## 5. 分类规则

### 5.1 必须保留

满足任一条件即归入必须保留：

- 当前事实源：`README.md`、`current-phase.md`、`TODO.md`、`.dev_plan.md`。
- 本地审计主记录：`.codex/operations-log.md`、`.codex/verification-report.md`。
- 当前剪枝总控与上下文：`.codex/project-pruning-and-improvement-dispatch.md`、`.codex/context-summary-项目剪枝完善.md`。
- 共享契约与生成类型：`packages/shared/src/contracts/storyforge.openapi.json`、`packages/shared/src/generated/api-types.ts`。
- 真实 LLM 最新证据目录或被 `README.md`、`current-phase.md` 明确引用的证据目录。
- Next.js App Router 契约文件：`apps/web/app/**/page.tsx`、`layout.tsx`、`route.ts`。

### 5.2 建议归档

满足任一条件且不属于必须保留时，归入建议归档：

- `.codex/uiux-*.png` 等页面验证截图。
- `.codex/real-llm-*` 中未被当前事实源引用的历史运行目录。
- `.codex/*smoke*`、`.codex/*llm*` 中有审计价值但不需要常驻根层的制品。
- 旧上下文摘要、旧计划执行记录和历史调试脚本。
- 根目录旧补丁或阶段性临时文档。

### 5.3 可删除

满足任一条件且不属于必须保留或建议归档时，归入可删除：

- `.pytest_cache`
- `.ruff_cache`
- `__pycache__`
- `.next`
- `tsconfig.tsbuildinfo`
- 浏览器临时 profile 中的 `Cache`、`GPUCache`、`CrashpadMetrics`。
- 明确临时调试文件，例如 `.codex/tmp-*.cjs`。
- 已确认可重新生成且没有审计引用的开发日志。

### 5.4 需人工确认

满足任一条件时归入需人工确认：

- 当前 `git status --short` 中已修改或未跟踪的非缓存文件。
- 文件名显示与真实 LLM、BookRun、Judge、Repair、OpenAPI、E2E 或审计报告有关，但无法从扫描判断是否已有替代证据。
- 大型 SQLite、导出物、运行产物和长篇正文目录。
- 与用户最近工作直接相关的文件。

## 6. 执行流程

1. 读取 `git status --short`、当前分支和最近提交，记录工作树保护范围。
2. 扫描目标目录，只收集路径、大小、修改时间、扩展名和匹配规则。
3. 应用分类规则，先匹配必须保留，再匹配需人工确认，再匹配建议归档，最后匹配可删除。
4. 生成 `pruning-dry-run-report.md`。
5. 执行报告完整性检查，确认四类清单和下一步选项存在。
6. 不执行删除或移动。

## 7. 验证方式

本轮验证以本地可重复检查为主：

```powershell
cd D:\StoryForge
Test-Path .codex\pruning-dry-run-report.md
Select-String -Path .codex\pruning-dry-run-report.md -Pattern "必须保留|建议归档|可删除|需人工确认|下一步执行选项"
git status --short
```

通过条件：

- 报告文件存在。
- 必需章节全部存在。
- `git status --short` 未出现非预期业务代码变更。
- 报告没有声称已经删除或移动任何文件。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 误把审计证据归为可删除 | 破坏真实 LLM 或发布门禁证据 | 当前事实源引用、真实 LLM、BookRun、Judge、Repair、audit 相关路径默认进入保留或人工确认 |
| 工作树已有大量未提交改动 | 可能覆盖用户工作 | 本轮只新增报告，不修改既有业务文件 |
| `.codex/operations-log.md` 过大 | 扫描时浪费上下文 | 只统计，不全文读取 |
| 生成契约被误判为大文件垃圾 | 破坏 OpenAPI 和前后端类型 | OpenAPI JSON 与生成类型强制保留 |
| App Router 文件被误判为未引用 | 破坏 Web 路由 | `page.tsx`、`layout.tsx`、`route.ts` 强制保护 |

## 9. 后续决策

dry-run 报告完成后，建议按以下顺序推进：

1. 用户审阅 `pruning-dry-run-report.md`。
2. 先执行明确缓存删除任务，验证工作树和测试入口不受影响。
3. 再执行 `.codex` 历史制品归档任务。
4. 最后再讨论源码级剪枝或文档事实源收敛。

## 10. 自审结论

- 本设计没有实际删除或移动文件。
- 本设计的输出物、分类规则、验证命令和风险缓解均明确。
- 本设计与现有 `.codex/project-pruning-and-improvement-dispatch.md` 的任务卡 A 保持一致。
- 本设计可以独立转化为后续 implementation plan。
