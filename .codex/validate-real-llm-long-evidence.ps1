param(
  [Parameter(Mandatory = $true)]
  [string]$RunDirectory,
  [int]$ExpectedChapterCount = 10,
  [int]$TokenBudget = 200000,
  [int]$MinQualityScore = 90,
  [int]$MaxQualityIssueCount = 3,
  [double]$MinContextCacheHitRate = 0.95,
  [int]$MaxMemoryRecallBudgetUsed = 8000,
  [double]$MinArcCompletionRate = 0.7,
  [double]$MaxDbQueryCountPerChapter = 3,
  [double]$MaxChapterGenerationTimeP50 = 20,
  [double]$MinConcurrentChapterUtilization = 0.6,
  [switch]$RequireIntegrationGate,
  [switch]$RequireManualReadthrough,
  [switch]$RequireToolCallStoryStateChanges
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
$epubPath = Join-Path $resolvedDirectory "book.epub"
$auditPath = Join-Path $resolvedDirectory "audit_report.json"
$stdoutPath = Join-Path $resolvedDirectory "stdout.json"
$stderrPath = Join-Path $resolvedDirectory "stderr.log"

$summary = Read-JsonOrNull -Path $summaryPath
$metadata = Read-JsonOrNull -Path $metadataPath
$auditReport = Read-JsonOrNull -Path $auditPath

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
Write-Presence "book.epub" $epubPath
Write-Presence "audit_report.json" $auditPath
Write-Presence "stdout.json" $stdoutPath
Write-Presence "stderr.log" $stderrPath

$failures = @()
foreach ($path in @($summaryPath, $metadataPath, $riskPath, $todoPath, $bookPath, $epubPath, $auditPath, $stdoutPath, $stderrPath)) {
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
  Write-Output "epub_artifact_id: $($summary.epub_artifact_id)"
  Write-Output "audit_artifact_id: $($summary.audit_artifact_id)"
  Write-Output "prompt_tokens_used: $($summary.prompt_tokens_used)"
  Write-Output "completion_tokens_used: $($summary.completion_tokens_used)"
  Write-Output "cost_cny_estimated: $($summary.cost_cny_estimated)"

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
  if (-not $summary.artifact_hashes.book_epub_sha256) {
    $failures += "缺少 book_epub_sha256"
  }
  if (-not $summary.artifact_hashes.audit_report_sha256) {
    $failures += "缺少 audit_report_sha256"
  }
  if (-not $summary.markdown_artifact_id) {
    $failures += "缺少 markdown_artifact_id"
  }
  if (-not $summary.epub_artifact_id) {
    $failures += "缺少 epub_artifact_id"
  }
  if (-not $summary.audit_artifact_id) {
    $failures += "缺少 audit_artifact_id"
  }
  if ($null -eq $summary.cost_breakdown) {
    $failures += "缺少 cost_breakdown"
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

  $integrationMetrics = $summary.integration_metrics
  if ($null -eq $integrationMetrics) {
    if ($RequireIntegrationGate) {
      $failures += "缺少 integration_metrics"
    }
  } else {
    $contextCacheHitRate = $integrationMetrics.context_cache_hit_rate
    if ($null -eq $contextCacheHitRate) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 context_cache_hit_rate"
      }
    } else {
      Write-Output "context_cache_hit_rate: $contextCacheHitRate"
      if ($RequireIntegrationGate -and [double]$contextCacheHitRate -le $MinContextCacheHitRate) {
        $failures += "context_cache_hit_rate 未超过 $MinContextCacheHitRate"
      }
    }

    $memoryRecallBudgetUsed = $integrationMetrics.memory_recall_budget_used
    if ($null -eq $memoryRecallBudgetUsed) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 memory_recall_budget_used"
      }
    } else {
      Write-Output "memory_recall_budget_used: $memoryRecallBudgetUsed"
      if ($RequireIntegrationGate -and [double]$memoryRecallBudgetUsed -ge $MaxMemoryRecallBudgetUsed) {
        $failures += "memory_recall_budget_used 未低于 $MaxMemoryRecallBudgetUsed"
      }
    }

    $arcCompletionRate = $integrationMetrics.arc_completion_rate
    if ($null -eq $arcCompletionRate) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 arc_completion_rate"
      }
    } else {
      Write-Output "arc_completion_rate: $arcCompletionRate"
      if ($RequireIntegrationGate -and [double]$arcCompletionRate -lt $MinArcCompletionRate) {
        $failures += "arc_completion_rate 低于 $MinArcCompletionRate"
      }
    }

    $dbQueryCountPerChapter = $integrationMetrics.db_query_count_per_chapter
    if ($null -eq $dbQueryCountPerChapter) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 db_query_count_per_chapter"
      }
    } else {
      Write-Output "db_query_count_per_chapter: $dbQueryCountPerChapter"
      if ($RequireIntegrationGate -and [double]$dbQueryCountPerChapter -gt $MaxDbQueryCountPerChapter) {
        $failures += "db_query_count_per_chapter 超过 $MaxDbQueryCountPerChapter"
      }
    }

    $chapterGenerationTimeP50 = $integrationMetrics.chapter_generation_time_p50
    if ($null -eq $chapterGenerationTimeP50) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 chapter_generation_time_p50"
      }
    } else {
      Write-Output "chapter_generation_time_p50: $chapterGenerationTimeP50"
      if ($RequireIntegrationGate -and [double]$chapterGenerationTimeP50 -ge $MaxChapterGenerationTimeP50) {
        $failures += "chapter_generation_time_p50 未低于 $MaxChapterGenerationTimeP50 秒"
      }
    }

    $concurrentChapterUtilization = $integrationMetrics.concurrent_chapter_utilization
    if ($null -eq $concurrentChapterUtilization) {
      if ($RequireIntegrationGate) {
        $failures += "缺少 concurrent_chapter_utilization"
      }
    } else {
      Write-Output "concurrent_chapter_utilization: $concurrentChapterUtilization"
      if ($RequireIntegrationGate -and [double]$concurrentChapterUtilization -le $MinConcurrentChapterUtilization) {
        $failures += "concurrent_chapter_utilization 未超过 $MinConcurrentChapterUtilization"
      }
    }
  }
}

if ($null -eq $auditReport) {
  $failures += "audit_report.json 不可解析"
} else {
  $advisory = $auditReport.full_book_advisory_audit
  if ($null -eq $advisory) {
    $failures += "缺少 full_book_advisory_audit"
  } else {
    Write-Output "full_book_advisory_status: $($advisory.status)"
    Write-Output "full_book_advisory_hard_gate: $($advisory.hard_gate)"
    if ($advisory.hard_gate -ne $false) {
      $failures += "full_book_advisory_audit.hard_gate 必须为 false"
    }
    if (-not $advisory.status) {
      $failures += "缺少 full_book_advisory_audit.status"
    }
    if ($null -eq $advisory.checks) {
      $failures += "缺少 full_book_advisory_audit.checks"
    }
  }
  if ($null -eq $auditReport.quality_summary -or -not $auditReport.quality_summary.full_book_advisory_status) {
    $failures += "缺少 quality_summary.full_book_advisory_status"
  } else {
    Write-Output "quality_summary_full_book_advisory_status: $($auditReport.quality_summary.full_book_advisory_status)"
  }

  $storyStateSources = @()
  foreach ($metric in @($summary.per_chapter_metrics)) {
    if ($null -ne $metric -and $metric.PSObject.Properties.Name -contains "story_state_changes_source") {
      $source = [string]$metric.story_state_changes_source
      if ($source.Trim()) {
        $storyStateSources += $source.Trim()
      }
    }
  }
  foreach ($chapter in @($auditReport.chapters)) {
    if ($null -ne $chapter -and $chapter.PSObject.Properties.Name -contains "story_state_changes_source") {
      $source = [string]$chapter.story_state_changes_source
      if ($source.Trim()) {
        $storyStateSources += $source.Trim()
      }
    }
  }
  $validStoryStateSources = @($storyStateSources | Where-Object { $_ -and $_.ToLowerInvariant() -notin @("none", "missing", "unavailable", "null") })
  $toolCallStoryStateSources = @($validStoryStateSources | Where-Object { $_.ToLowerInvariant().StartsWith("tool_call") })
  Write-Output "story_state_changes_sources: $($validStoryStateSources -join ',')"
  if ($validStoryStateSources.Count -eq 0) {
    $failures += "缺少 story_state_changes_source 证据"
  }
  if ($RequireToolCallStoryStateChanges -and $toolCallStoryStateSources.Count -eq 0) {
    $failures += "缺少 tool_call story_state_changes_source 证据"
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
    if ($ExpectedChapterCount -ge 30) {
      Write-Output "gate: pass_for_real_30ch_final_acceptance"
      Write-Output "note: 该结论覆盖当前真实 30 章集成验证的技术证据与人工通读完成证据。"
    } else {
      Write-Output "gate: pass_for_real_10ch_final_acceptance"
      Write-Output "note: 该结论覆盖当前真实 10 章 smoke 的技术证据与人工通读完成证据；仍不代表 3-5 万字长程完成。"
    }
  } else {
    if ($ExpectedChapterCount -ge 30) {
      Write-Output "gate: pass_for_real_30ch_integration_scope"
      Write-Output "note: 该结论只覆盖当前真实 30 章集成验证技术证据；人工通读完成前不得声明最终验收完成。"
    } else {
      Write-Output "gate: pass_for_real_10ch_scope"
      Write-Output "note: 该结论只覆盖当前真实 10 章 smoke；人工通读完成前不得声明 10 章最终验收完成，也不代表 3-5 万字长程完成。"
    }
  }
  exit 0
}

Write-Output "gate: fail"
foreach ($failure in $failures) {
  Write-Output "failure: $failure"
}
exit 1
