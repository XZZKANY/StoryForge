# Codex Pruning Dry-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成 `D:\StoryForge\.codex\pruning-dry-run-report.md`，只读扫描仓库制品并给出“必须保留 / 建议归档 / 可删除 / 需人工确认”四类清单。

**Architecture:** 本任务不删除、不移动、不修改业务代码。实现采用一个临时 PowerShell 扫描流程直接生成 Markdown 报告，报告内记录分类规则命中依据、风险和下一步选项；后续若需要复用，再把扫描流程固化为脚本。分类顺序固定为“必须保留 → 需人工确认 → 建议归档 → 可删除”，避免审计证据被过度清理。

**Tech Stack:** PowerShell、Git、Markdown、本地文件系统只读扫描。

---

## 文件职责总览

### 新增文件

- `D:\StoryForge\.codex\pruning-dry-run-report.md`
  - 职责：记录本轮只读扫描结果、四类清单、依据、风险、验证方式和下一步执行选项。

### 修改文件

- 无业务代码修改。
- 不修改 `apps/`、`packages/`、`docs/`、`scripts/`。
- 不追加 `.codex/operations-log.md`，避免当前大日志继续膨胀；本轮执行事实写入 dry-run 报告自身。

### 只读参考文件

- `D:\StoryForge\docs\superpowers\specs\2026-06-03-codex-pruning-dry-run-design.md`
- `D:\StoryForge\.codex\project-pruning-and-improvement-dispatch.md`
- `D:\StoryForge\README.md`
- `D:\StoryForge\current-phase.md`
- `D:\StoryForge\package.json`

### 保护文件

- `D:\StoryForge\README.md`
- `D:\StoryForge\current-phase.md`
- `D:\StoryForge\TODO.md`
- `D:\StoryForge\.dev_plan.md`
- `D:\StoryForge\.codex\operations-log.md`
- `D:\StoryForge\.codex\verification-report.md`
- `D:\StoryForge\.codex\project-pruning-and-improvement-dispatch.md`
- `D:\StoryForge\packages\shared\src\contracts\storyforge.openapi.json`
- `D:\StoryForge\packages\shared\src\generated\api-types.ts`
- `D:\StoryForge\apps\web\app\**\page.tsx`
- `D:\StoryForge\apps\web\app\**\layout.tsx`
- `D:\StoryForge\apps\web\app\**\route.ts`

---

## Task 1: 建立扫描基线与报告骨架

**Files:**

- Create: `D:\StoryForge\.codex\pruning-dry-run-report.md`
- Read: `D:\StoryForge\docs\superpowers\specs\2026-06-03-codex-pruning-dry-run-design.md`

- [ ] **Step 1: 确认工作树保护范围**

Run:

```powershell
cd D:\StoryForge
git branch --show-current
git log -1 --oneline
git status --short
```

Expected:

```text
输出当前分支、最近提交和已有未提交改动。不得清理、恢复或暂存这些既有改动。
```

- [ ] **Step 2: 创建报告骨架**

Run:

```powershell
cd D:\StoryForge
$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$branch = git branch --show-current
$head = git log -1 --oneline
$status = git status --short
$report = @"
# StoryForge 仓库瘦身 Dry-run 报告

生成时间：$now
项目根目录：D:\StoryForge
当前分支：$branch
最近提交：$head

## 1. 执行边界

- 本轮只读扫描，不删除、不移动、不改写业务代码。
- 本轮输出只写入 `.codex/pruning-dry-run-report.md`。
- 当前工作树已有未提交改动，本报告只记录状态，不处理归属。

## 2. 工作树摘要

````text
$($status -join "`n")
````

## 3. 总体统计

待扫描回填。

## 4. 必须保留

待扫描回填。

## 5. 建议归档

待扫描回填。

## 6. 可删除

待扫描回填。

## 7. 需人工确认

待扫描回填。

## 8. 风险与保护规则

待扫描回填。

## 9. 下一步执行选项

待扫描回填。

## 10. 本地验证记录

待扫描回填。
"@
$report | Set-Content -LiteralPath .codex\pruning-dry-run-report.md -Encoding UTF8
```

Expected:

```text
.codex/pruning-dry-run-report.md 创建成功，包含 1-10 节。
```

- [ ] **Step 3: 验证报告骨架章节存在**

Run:

```powershell
cd D:\StoryForge
Test-Path .codex\pruning-dry-run-report.md
Select-String -Path .codex\pruning-dry-run-report.md -Pattern "执行边界|工作树摘要|总体统计|必须保留|建议归档|可删除|需人工确认|下一步执行选项|本地验证记录"
```

Expected:

```text
Test-Path 输出 True；Select-String 找到所有章节。
```

---

## Task 2: 执行只读扫描并生成分类数据

**Files:**

- Modify: `D:\StoryForge\.codex\pruning-dry-run-report.md`

- [ ] **Step 1: 运行只读扫描并生成内存分类**

Run:

```powershell
cd D:\StoryForge
$root = (Get-Location).Path
$protectedExact = @(
  'README.md',
  'current-phase.md',
  'TODO.md',
  '.dev_plan.md',
  '.codex/operations-log.md',
  '.codex/verification-report.md',
  '.codex/project-pruning-and-improvement-dispatch.md',
  'packages/shared/src/contracts/storyforge.openapi.json',
  'packages/shared/src/generated/api-types.ts'
)
$deletePatterns = @(
  '\.pytest_cache(/|$)',
  '\.ruff_cache(/|$)',
  '__pycache__(/|$)',
  '\.next(/|$)',
  'tsconfig\.tsbuildinfo$',
  '(^|/)Cache(/|$)',
  '(^|/)GPUCache(/|$)',
  '(^|/)CrashpadMetrics(/|$)',
  '^\.codex/tmp-.*\.cjs$'
)
$archivePatterns = @(
  '^\.codex/uiux-.*\.(png|jpg|jpeg|webp)$',
  '^\.codex/.*\.(log)$',
  '^\.codex/.*smoke.*',
  '^\.codex/.*llm.*',
  '^\.codex/context-summary-.*\.md$'
)
$manualPatterns = @(
  'real-llm',
  'BookRun',
  'book-run',
  'judge',
  'repair',
  'audit',
  'openapi',
  '\.sqlite$',
  '\.db$'
)

$statusPaths = git status --short | ForEach-Object {
  if ($_.Length -ge 4) { $_.Substring(3).Trim('"') -replace '\\','/' }
}
$files = Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object {
    $relative = Resolve-Path -LiteralPath $_.FullName -Relative
    $relative = $relative.TrimStart('.\') -replace '\\','/'
    $relative -notmatch '(^|/)node_modules(/|$)' -and
    $relative -notmatch '(^|/)\.git(/|$)' -and
    $relative -notmatch '(^|/)\.venv(/|$)'
  } |
  ForEach-Object {
    $relative = Resolve-Path -LiteralPath $_.FullName -Relative
    $relative = $relative.TrimStart('.\') -replace '\\','/'
    $category = '需人工确认'
    $reason = '默认保守分类。'
    if ($protectedExact -contains $relative -or $relative -match '^apps/web/app/.*/(page|layout|route)\.tsx$') {
      $category = '必须保留'
      $reason = '命中事实源、生成契约或 App Router 路由契约保护规则。'
    } elseif ($statusPaths -contains $relative) {
      $category = '需人工确认'
      $reason = '当前 git status 中存在，不能由自动规则处理。'
    } elseif (($manualPatterns | Where-Object { $relative -match $_ }).Count -gt 0) {
      $category = '需人工确认'
      $reason = '文件名或路径涉及真实 LLM、BookRun、Judge、Repair、OpenAPI、审计或数据库制品。'
    } elseif (($archivePatterns | Where-Object { $relative -match $_ }).Count -gt 0) {
      $category = '建议归档'
      $reason = '命中历史截图、日志、上下文摘要或运行制品归档规则。'
    } elseif (($deletePatterns | Where-Object { $relative -match $_ }).Count -gt 0) {
      $category = '可删除'
      $reason = '命中明确缓存、临时调试文件或可重新生成制品规则。'
    }
    [PSCustomObject]@{
      Path = $relative
      Category = $category
      Reason = $reason
      SizeBytes = $_.Length
      LastWriteTime = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    }
  }

$files | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath .codex\pruning-dry-run-data.json -Encoding UTF8
```

Expected:

```text
.codex/pruning-dry-run-data.json 创建成功。该文件是临时中间产物，最终报告生成后必须删除或归入可删除说明。
```

- [ ] **Step 2: 检查分类数据基本可读**

Run:

```powershell
cd D:\StoryForge
$data = Get-Content .codex\pruning-dry-run-data.json -Raw | ConvertFrom-Json
$data | Group-Object Category | Select-Object Name,Count | Format-Table -AutoSize
$data | Sort-Object SizeBytes -Descending | Select-Object -First 10 Path,Category,SizeBytes | Format-Table -AutoSize
```

Expected:

```text
输出至少包含“必须保留”“建议归档”“可删除”“需人工确认”中的若干分类，并列出 Top 10 大文件。
```

---

## Task 3: 回填 Markdown 报告

**Files:**

- Modify: `D:\StoryForge\.codex\pruning-dry-run-report.md`
- Delete: `D:\StoryForge\.codex\pruning-dry-run-data.json`

- [ ] **Step 1: 用分类数据生成最终报告正文**

Run:

```powershell
cd D:\StoryForge
$data = Get-Content .codex\pruning-dry-run-data.json -Raw | ConvertFrom-Json
$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$branch = git branch --show-current
$head = git log -1 --oneline
$status = git status --short
$totalFiles = $data.Count
$totalBytes = ($data | Measure-Object SizeBytes -Sum).Sum
$totalMb = [Math]::Round($totalBytes / 1MB, 2)

function Format-Rows($items, [int]$limit = 40) {
  if (-not $items -or $items.Count -eq 0) {
    return "- 无。"
  }
  return ($items | Sort-Object SizeBytes -Descending | Select-Object -First $limit | ForEach-Object {
    "- `$($_.Path)`：$($_.Reason) 大小 $($_.SizeBytes) bytes，修改时间 $($_.LastWriteTime)。"
  }) -join "`n"
}

$mustKeep = @($data | Where-Object Category -eq '必须保留')
$archive = @($data | Where-Object Category -eq '建议归档')
$delete = @($data | Where-Object Category -eq '可删除')
$manual = @($data | Where-Object Category -eq '需人工确认')
$topLarge = Format-Rows ($data | Sort-Object SizeBytes -Descending | Select-Object -First 20) 20
$mustKeepRows = Format-Rows $mustKeep 60
$archiveRows = Format-Rows $archive 80
$deleteRows = Format-Rows $delete 80
$manualRows = Format-Rows $manual 80

$report = @"
# StoryForge 仓库瘦身 Dry-run 报告

生成时间：$now
项目根目录：D:\StoryForge
当前分支：$branch
最近提交：$head

## 1. 执行边界

- 本轮只读扫描，不删除、不移动、不改写业务代码。
- 本轮输出只写入 `.codex/pruning-dry-run-report.md`。
- 当前工作树已有未提交改动，本报告只记录状态，不处理归属。
- 中间扫描数据 `.codex/pruning-dry-run-data.json` 会在报告生成后删除。

## 2. 工作树摘要

````text
$($status -join "`n")
````

## 3. 总体统计

- 扫描文件数：$totalFiles
- 扫描文件总大小：$totalMb MB
- 必须保留：$($mustKeep.Count)
- 建议归档：$($archive.Count)
- 可删除：$($delete.Count)
- 需人工确认：$($manual.Count)

### Top 大文件

$topLarge

## 4. 必须保留

$mustKeepRows

## 5. 建议归档

$archiveRows

## 6. 可删除

$deleteRows

## 7. 需人工确认

$manualRows

## 8. 风险与保护规则

- 真实 LLM、BookRun、Judge、Repair、audit、OpenAPI、SQLite/DB 相关路径默认进入“需人工确认”或“必须保留”。
- 当前 git status 中出现的文件默认进入“需人工确认”，避免覆盖用户或历史未提交工作。
- App Router 的 `page.tsx`、`layout.tsx`、`route.ts` 按路由契约保护，不能按普通未引用文件处理。
- OpenAPI JSON 与生成 TypeScript 类型属于生成契约，不能手动剪枝。
- 本报告只给建议，不代表已经删除或归档任何文件。

## 9. 下一步执行选项

1. 先人工审阅本报告，标记哪些“建议归档”和“可删除”可以进入真实执行。
2. 先删除明确缓存项，例如 `.pytest_cache`、`.ruff_cache`、`__pycache__`、`.next` 和浏览器缓存目录。
3. 先归档 `.codex/uiux-*.png`、旧日志和历史上下文摘要，保留真实 LLM 与审计证据目录。
4. 暂缓所有源码级剪枝，另开 API/Workflow/Web 专项报告。

## 10. 本地验证记录

- 待执行：`Test-Path .codex\pruning-dry-run-report.md`
- 待执行：`Select-String -Path .codex\pruning-dry-run-report.md -Pattern "必须保留|建议归档|可删除|需人工确认|下一步执行选项"`
- 待执行：`git status --short`
"@
$report | Set-Content -LiteralPath .codex\pruning-dry-run-report.md -Encoding UTF8
Remove-Item -LiteralPath .codex\pruning-dry-run-data.json
```

Expected:

```text
.codex/pruning-dry-run-report.md 包含真实扫描统计；.codex/pruning-dry-run-data.json 已删除。
```

- [ ] **Step 2: 验证中间产物已清理**

Run:

```powershell
cd D:\StoryForge
Test-Path .codex\pruning-dry-run-data.json
```

Expected:

```text
False
```

---

## Task 4: 验证报告完整性与工作树保护

**Files:**

- Modify: `D:\StoryForge\.codex\pruning-dry-run-report.md`

- [ ] **Step 1: 验证报告章节存在**

Run:

```powershell
cd D:\StoryForge
Test-Path .codex\pruning-dry-run-report.md
Select-String -Path .codex\pruning-dry-run-report.md -Pattern "必须保留|建议归档|可删除|需人工确认|下一步执行选项"
```

Expected:

```text
Test-Path 输出 True；Select-String 找到所有关键分类章节。
```

- [ ] **Step 2: 确认报告未声称已删除**

Run:

```powershell
cd D:\StoryForge
Select-String -Path .codex\pruning-dry-run-report.md -Pattern "已删除|已移动|已归档"
```

Expected:

```text
无输出。若出现输出，必须确认只是验证命令描述；否则改成“建议删除/建议归档”。
```

- [ ] **Step 3: 确认工作树只新增报告**

Run:

```powershell
cd D:\StoryForge
git status --short .codex/pruning-dry-run-report.md .codex/pruning-dry-run-data.json
```

Expected:

```text
只显示 .codex/pruning-dry-run-report.md 为新增或修改；不显示 .codex/pruning-dry-run-data.json。
```

- [ ] **Step 4: 暂存报告并检查空白**

Run:

```powershell
cd D:\StoryForge
git add -- .codex/pruning-dry-run-report.md
git diff --cached --check
git diff --cached --name-only
```

Expected:

```text
diff --check 无输出；cached name-only 只包含 .codex/pruning-dry-run-report.md。
```

- [ ] **Step 5: 提交报告**

Run:

```powershell
cd D:\StoryForge
git commit -m "生成仓库瘦身 dry-run 报告"
```

Expected:

```text
提交成功，提交内容只包含 .codex/pruning-dry-run-report.md。
```

---

## Task 5: 收尾复核

**Files:**

- Read: `D:\StoryForge\.codex\pruning-dry-run-report.md`

- [ ] **Step 1: 查看最新提交内容**

Run:

```powershell
cd D:\StoryForge
git show --stat --oneline --name-only HEAD
```

Expected:

```text
最新提交为“生成仓库瘦身 dry-run 报告”，且只包含 .codex/pruning-dry-run-report.md。
```

- [ ] **Step 2: 复查报告关键结论**

Run:

```powershell
cd D:\StoryForge
Select-String -Path .codex\pruning-dry-run-report.md -Pattern "扫描文件数|必须保留|建议归档|可删除|需人工确认|下一步执行选项"
```

Expected:

```text
输出关键统计和分类章节。
```

- [ ] **Step 3: 输出交付摘要**

Final response must include:

```text
已生成 dry-run 报告：D:\StoryForge\.codex\pruning-dry-run-report.md
本轮未删除、未移动任何文件。
报告给出必须保留、建议归档、可删除、需人工确认四类清单。
```

---

## Self-Review

### Spec coverage

- 只读扫描：Task 1-4 覆盖。
- 四类清单：Task 2-3 覆盖。
- 报告输出路径：Task 1、Task 3 覆盖。
- 不删除不移动：Task 1、Task 3、Task 4 覆盖。
- 工作树保护：Task 1、Task 4 覆盖。
- 本地验证：Task 4、Task 5 覆盖。

### Placeholder scan

- 本计划没有使用 TBD、TODO、待补、占位。
- 所有命令均给出具体路径、命令和期望输出。

### Consistency check

- 报告路径统一为 `D:\StoryForge\.codex\pruning-dry-run-report.md`。
- 中间数据路径统一为 `.codex\pruning-dry-run-data.json`，并在 Task 3 删除。
- 分类名称统一为“必须保留 / 建议归档 / 可删除 / 需人工确认”。
