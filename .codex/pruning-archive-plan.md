# StoryForge 仓库瘦身归档预案

生成时间：2026-06-04 08:30 +08:00

## 1. 执行边界

- 本文档是归档预案，不是归档执行记录。
- 本轮未对真实项目文件执行删除、移动或归档操作。
- 本轮只基于 `.codex/pruning-dry-run-report.md` 制定后续方案。
- 真实归档前必须重新扫描当前主工作树，并由用户确认待处理清单。
- 不修改 `apps/`、`packages/`、`docs/`、`scripts/` 中的业务代码。

## 2. 输入证据

- `.codex/pruning-dry-run-report.md`：dry-run 扫描文件数 928；分类为必须保留 26、建议归档 202、可删除 0、需人工确认 700。
- `.codex/project-pruning-and-improvement-dispatch.md`：要求先只读扫描，再给建议；真实删除、移动、重构前必须列出证据和回滚方案。
- 当前 `git status --short` 显示主工作树已有大量既有未提交改动；后续真实归档不得覆盖或混淆这些改动。

## 3. 归档原则

1. 先归档，后删除；删除必须另开任务确认。
2. 先处理低风险本地制品，再处理历史文档和补丁。
3. 真实 LLM、BookRun、Judge、Repair、audit、OpenAPI、SQLite/DB 相关路径默认不自动归档。
4. 当前事实源、共享契约和路由契约必须保留原位。
5. 每次真实归档都必须保留移动前清单、移动后清单和回滚命令。

## 4. 归档批次

### 批次 A：上下文摘要归档

- 候选模式：`.codex/context-summary-*.md`
- 建议目标：`.codex/archive/context-summaries/`
- 处理方式：仅归档旧任务上下文摘要；当前任务相关摘要和最新事实源保留原位。
- 回滚方式：按移动清单把文件移回 `.codex/` 根层。
- 验证命令：

```powershell
Get-ChildItem .codex -Filter "context-summary-*.md"
Get-ChildItem .codex\archive\context-summaries -Filter "context-summary-*.md"
```

### 批次 B：日志归档

- 候选模式：`.codex/*.log`、`.codex/*.err.log`
- 建议目标：`.codex/archive/logs/`
- 处理方式：仅归档开发服务器、浏览器验证和临时调试日志。
- 默认排除：`.codex/operations-log.md`、`.codex/verification-report.md`。
- 回滚方式：按移动清单把日志移回原路径。
- 验证命令：

```powershell
Get-ChildItem .codex -File | Where-Object { $_.Name -match "\.log$" }
Get-ChildItem .codex\archive\logs -File
```

### 批次 C：UI/UX 截图归档

- 候选模式：`.codex/uiux-*.png`
- 建议目标：`.codex/archive/uiux-screenshots/`
- 处理方式：归档历史截图证据，保留最新人工仍需对照的截图由用户确认。
- 回滚方式：按移动清单把截图移回 `.codex/` 根层。
- 验证命令：

```powershell
Get-ChildItem .codex -Filter "uiux-*.png"
Get-ChildItem .codex\archive\uiux-screenshots -Filter "uiux-*.png"
```

### 批次 D：历史 smoke/llm 辅助文件归档

- 候选模式：`.codex/*smoke*`、`.codex/*llm*`
- 建议目标：`.codex/archive/smoke-and-llm/`
- 处理方式：只归档明确不是当前事实源引用的历史辅助脚本、摘要或旧证据。
- 默认排除：`current-phase.md`、`README.md` 明确引用的真实 LLM 证据目录；`.sqlite`、`book.md`、`audit_report.json` 先进入人工确认。
- 回滚方式：按移动清单还原原路径。
- 验证命令：

```powershell
Select-String -Path README.md,current-phase.md -Pattern "real-llm|smoke|audit_report|book.md"
Get-ChildItem .codex -Recurse | Where-Object { $_.Name -match "smoke|llm" }
```

### 批次 E：历史补丁与根目录临时材料归档

- 候选模式：`.codex-fix-phase9b-*.patch`、`.local.patch`、`.codex/*.patch`
- 建议目标：`.codex/archive/patches/`
- 处理方式：只归档已经被提交历史替代、且不再作为当前修复依据的补丁。
- 默认排除：当前未提交改动直接相关的补丁。
- 回滚方式：按移动清单还原原路径。
- 验证命令：

```powershell
Get-ChildItem -Force -File | Where-Object { $_.Name -match "\.patch$" }
Get-ChildItem .codex -File | Where-Object { $_.Name -match "\.patch$" }
```

## 5. 保护清单

以下文件或路径不进入自动归档：

- `README.md`
- `current-phase.md`
- `TODO.md`
- `.dev_plan.md`
- `.codex/operations-log.md`
- `.codex/verification-report.md`
- `.codex/pruning-dry-run-report.md`
- `.codex/pruning-archive-plan.md`
- `.codex/project-pruning-and-improvement-dispatch.md`
- `packages/shared/src/contracts/storyforge.openapi.json`
- `packages/shared/src/generated/api-types.ts`
- `apps/web/app/**/page.tsx`
- `apps/web/app/**/layout.tsx`
- `apps/web/app/**/route.ts`
- 任何被 `README.md` 或 `current-phase.md` 明确引用的真实 LLM 证据目录。

## 6. 执行前门禁

真实归档任务开始前必须完成：

1. 运行 `git status --short`，确认所有既有未提交改动归属。
2. 重新扫描当前主工作树，不复用隔离 worktree 的可删除结论。
3. 生成待移动清单，逐条列出源路径、目标路径、理由和回滚命令。
4. 用户确认待移动清单。
5. 只执行被确认批次，不混入源码重构或删除动作。

## 7. 回滚方式

每个真实归档批次都必须生成移动清单，推荐格式：

```markdown
| 源路径 | 目标路径 | 回滚命令 |
| --- | --- | --- |
| .codex/example.log | .codex/archive/logs/example.log | Move-Item -LiteralPath .codex/archive/logs/example.log -Destination .codex/example.log |
```

如果归档后验证失败，按清单逐项执行回滚命令，再运行对应验证命令。

## 8. 本地验证

本预案生成后已执行以下只读验证：

```powershell
Test-Path .codex\pruning-archive-plan.md
Select-String -Path .codex\pruning-archive-plan.md -Pattern "执行边界|归档批次|保护清单|回滚方式|本地验证"
$dangerPattern = ("已" + "归档真实文件") + "|" + ("已" + "删除真实文件") + "|" + ("已" + "移动真实文件")
Select-String -Path .codex\pruning-archive-plan.md -Pattern $dangerPattern
git status --short .codex/pruning-archive-plan.md
```

通过标准：

- 预案文档存在。
- 关键章节可搜索到。
- 不出现声称已经处理真实项目文件的危险措辞。
- `git status` 仅显示本预案文档为新增文件。

## 9. 待用户确认项

1. 是否先处理批次 A：上下文摘要归档。
2. 是否保留最近 7 天内的 `.codex/context-summary-*.md` 在根层。
3. UI/UX 截图是否按日期全部归档，还是保留最新最终态截图。
4. 历史 smoke/llm 相关文件是否先只生成二次人工确认清单。
5. 真实归档是否继续使用 Subagent-Driven 流程执行。
