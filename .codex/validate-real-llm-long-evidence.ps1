param(
  [Parameter(Mandatory = $true)]
  [string]$RunDirectory,
  [int]$ExpectedChapterCount = 10,
  [int]$TokenBudget = 200000,
  [int]$MinQualityScore = 90,
  [int]$MaxQualityIssueCount = 3,
  [switch]$RequireManualReadthrough
)

$ErrorActionPreference = "Stop"

function Read-JsonOrNull {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-Presence {
  param(
    [string]$Name,
    [string]$Path
  )
  if (Test-Path -LiteralPath $Path) {
    Write-Output "${Name}: present"
  } else {
    Write-Output "${Name}: missing"
  }
}

$resolvedDirectory = (Resolve-Path -LiteralPath $RunDirectory).Path
$summaryPath = Join-Path $resolvedDirectory "summary.json"
$metadataPath = Join-Path $resolvedDirectory "run-metadata.json"
$riskPath = Join-Path $resolvedDirectory "quality-risk.md"
$todoPath = Join-Path $resolvedDirectory "human-readthrough-todo.md"
$manualReadthroughPath = Join-Path $resolvedDirectory "manual-readthrough-completion.md"
$bookPath = Join-Path $resolvedDirectory "book.md"
$auditPath = Join-Path $resolvedDirectory "audit_report.json"
$stdoutPath = Join-Path $resolvedDirectory "stdout.json"
$stderrPath = Join-Path $resolvedDirectory "stderr.log"

$summary = Read-JsonOrNull -Path $summaryPath
$metadata = Read-JsonOrNull -Path $metadataPath

Write-Output "真实 LLM 长程脱敏产物验收"
Write-Output "run_directory: $resolvedDirectory"
Write-Presence "summary.json" $summaryPath
Write-Presence "run-metadata.json" $metadataPath
Write-Presence "quality-risk.md" $riskPath
Write-Presence "human-readthrough-todo.md" $todoPath
if ($RequireManualReadthrough) {
  Write-Presence "manual-readthrough-completion.md" $manualReadthroughPath
}
Write-Presence "book.md" $bookPath
Write-Presence "audit_report.json" $auditPath
Write-Presence "stdout.json" $stdoutPath
Write-Presence "stderr.log" $stderrPath

$failures = @()
foreach ($path in @($summaryPath, $metadataPath, $riskPath, $todoPath, $bookPath, $auditPath, $stdoutPath, $stderrPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    $failures += "缺少必需产物：$(Split-Path -Leaf $path)"
  }
}

if ($null -eq $metadata) {
  $failures += "run-metadata.json 不可解析"
} else {
  Write-Output "runner_exit_code: $($metadata.runner_exit_code)"
  Write-Output "summary_present: $($metadata.summary_present)"
  Write-Output "sensitive_hit_count: $($metadata.sensitive_hit_count)"
  Write-Output "chapter_count: $($metadata.redacted_parameters.chapter_count)"
  Write-Output "target_word_count: $($metadata.redacted_parameters.target_word_count)"
  Write-Output "token_budget: $($metadata.redacted_parameters.token_budget)"
  Write-Output "timeout_seconds: $($metadata.redacted_parameters.timeout_seconds)"
  Write-Output "time_budget_seconds: $($metadata.redacted_parameters.time_budget_seconds)"
  Write-Output "outer_timeout_seconds: $($metadata.redacted_parameters.outer_timeout_seconds)"
  if ([int]$metadata.runner_exit_code -ne 0) {
    $failures += "runner_exit_code 非 0"
  }
  if ($metadata.summary_present -eq $false) {
    $failures += "run-metadata.json 标记 summary_present=false"
  }
  if ([int]$metadata.sensitive_hit_count -ne 0) {
    $failures += "sensitive_hit_count 非 0"
  }
}

if ($null -eq $summary) {
  $failures += "summary.json 不可解析"
} else {
  Write-Output "book_run_id: $($summary.book_run_id)"
  Write-Output "book_run_status: $($summary.book_run_status)"
  Write-Output "target_chapter_count: $($summary.target_chapter_count)"
  Write-Output "actual_chapter_count: $($summary.actual_chapter_count)"
  Write-Output "tokens_used: $($summary.tokens_used)"
  Write-Output "estimated_cost: $($summary.estimated_cost)"
  Write-Output "actual_total_chars: $($summary.actual_total_chars)"
  Write-Output "markdown_artifact_id: $($summary.markdown_artifact_id)"
  Write-Output "audit_artifact_id: $($summary.audit_artifact_id)"

  if ([string]$summary.book_run_status -ne "completed") {
    $failures += "BookRun 未 completed"
  }
  if ([int]$summary.actual_chapter_count -ne $ExpectedChapterCount) {
    $failures += "actual_chapter_count 不等于 $ExpectedChapterCount"
  }
  if ([int]$summary.tokens_used -ge $TokenBudget) {
    $failures += "tokens_used 达到或超过 token 预算"
  }
  if (-not $summary.artifact_hashes.book_md_sha256) {
    $failures += "缺少 book_md_sha256"
  }
  if (-not $summary.artifact_hashes.audit_report_sha256) {
    $failures += "缺少 audit_report_sha256"
  }
  if (-not $summary.markdown_artifact_id) {
    $failures += "缺少 markdown_artifact_id"
  }
  if (-not $summary.audit_artifact_id) {
    $failures += "缺少 audit_artifact_id"
  }

  $totalIssues = 0
  if ($null -eq $summary.per_chapter_metrics -or $summary.per_chapter_metrics.Count -eq 0) {
    $failures += "缺少 per_chapter_metrics"
  } else {
    foreach ($metric in $summary.per_chapter_metrics) {
      if ([int]$metric.quality_score -lt $MinQualityScore) {
        $failures += "第 $($metric.chapter_index) 章 quality_score 低于 $MinQualityScore"
      }
      $totalIssues += [int]$metric.quality_issue_count
    }
  }
  Write-Output "quality_issue_count_total: $totalIssues"
  if ($totalIssues -gt $MaxQualityIssueCount) {
    $failures += "累计 quality_issue_count 超过 $MaxQualityIssueCount"
  }
}

if ($RequireManualReadthrough) {
  if (-not (Test-Path -LiteralPath $manualReadthroughPath)) {
    $failures += "缺少 manual-readthrough-completion.md"
  } else {
    $manualReadthroughText = Get-Content -LiteralPath $manualReadthroughPath -Raw -Encoding UTF8
    if ($manualReadthroughText -notmatch "结论[:：]\s*通过") {
      $failures += "人工通读完成记录未包含通过结论"
    }
  }
}

if ($failures.Count -eq 0) {
  if ($RequireManualReadthrough) {
    Write-Output "gate: pass_for_real_10ch_final_acceptance"
    Write-Output "note: 该结论覆盖当前真实 10 章 smoke 的技术证据与人工通读完成证据；仍不代表 3-5 万字长程完成。"
  } else {
    Write-Output "gate: pass_for_real_10ch_scope"
    Write-Output "note: 该结论只覆盖当前真实 10 章 smoke；人工通读完成前不得声明 10 章最终验收完成，也不代表 3-5 万字长程完成。"
  }
  exit 0
}

Write-Output "gate: fail"
foreach ($failure in $failures) {
  Write-Output "failure: $failure"
}
exit 1
