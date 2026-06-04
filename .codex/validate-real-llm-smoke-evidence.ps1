param(
  [Parameter(Mandatory = $true)]
  [string]$RunDirectory
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
$stdoutPath = Join-Path $resolvedDirectory "stdout.json"
$stderrPath = Join-Path $resolvedDirectory "stderr.log"

$summary = Read-JsonOrNull -Path $summaryPath
$metadata = Read-JsonOrNull -Path $metadataPath

Write-Output "真实 LLM smoke 脱敏产物验收"
Write-Output "run_directory: $resolvedDirectory"
Write-Presence "summary.json" $summaryPath
Write-Presence "run-metadata.json" $metadataPath
Write-Presence "quality-risk.md" $riskPath
Write-Presence "human-readthrough-todo.md" $todoPath
Write-Presence "stdout.json" $stdoutPath
Write-Presence "stderr.log" $stderrPath

if ($null -ne $metadata) {
  Write-Output "runner_exit_code: $($metadata.runner_exit_code)"
  Write-Output "summary_present: $($metadata.summary_present)"
  Write-Output "sensitive_hit_count: $($metadata.sensitive_hit_count)"
  Write-Output "chapter_count: $($metadata.redacted_parameters.chapter_count)"
  Write-Output "target_word_count: $($metadata.redacted_parameters.target_word_count)"
  Write-Output "token_budget: $($metadata.redacted_parameters.token_budget)"
}

if ($null -ne $summary) {
  Write-Output "book_run_id: $($summary.book_run_id)"
  Write-Output "book_run_status: $($summary.book_run_status)"
  Write-Output "target_chapter_count: $($summary.target_chapter_count)"
  Write-Output "actual_chapter_count: $($summary.actual_chapter_count)"
  Write-Output "tokens_used: $($summary.tokens_used)"
  Write-Output "estimated_cost: $($summary.estimated_cost)"
  Write-Output "actual_total_chars: $($summary.actual_total_chars)"
  Write-Output "markdown_artifact_id: $($summary.markdown_artifact_id)"
  Write-Output "audit_artifact_id: $($summary.audit_artifact_id)"
}

$requiredFiles = @($summaryPath, $metadataPath, $riskPath, $todoPath)
$missingCount = 0
foreach ($path in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $path)) {
    $missingCount += 1
  }
}

$runnerExitCode = if ($null -ne $metadata) { [int]$metadata.runner_exit_code } else { 1 }
$sensitiveHitCount = if ($null -ne $metadata) { [int]$metadata.sensitive_hit_count } else { 1 }
$summaryPresent = ($null -ne $summary)
$status = if ($null -ne $summary) { [string]$summary.book_run_status } else { "" }

if ($missingCount -eq 0 -and $runnerExitCode -eq 0 -and $sensitiveHitCount -eq 0 -and $summaryPresent -and $status -eq "completed") {
  Write-Output "gate: pass_for_current_smoke_scope"
  Write-Output "note: 该结论只覆盖当前 smoke 范围，不代表 10 章或 3-5 万字长程完成。"
  exit 0
}

Write-Output "gate: fail"
Write-Output "note: 缺少必需脱敏产物、runner 非 0、敏感扫描命中、summary 缺失或 BookRun 未完成。"
exit 1
