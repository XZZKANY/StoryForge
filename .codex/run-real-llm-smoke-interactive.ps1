param(
  [ValidateSet(1, 3)]
  [int]$ChapterCount = 1,
  [int]$TokenBudget = 20000,
  [int]$TargetWordCount = 900,
  [int]$ChapterWordCountMin = 600,
  [int]$ChapterWordCountMax = 1600,
  [int]$TimeoutSeconds = 60,
  [int]$TimeBudgetSeconds = 900,
  [string]$Model = "gpt-5.4-mini"
)

$ErrorActionPreference = "Stop"

function Test-Present {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    "${Name}: missing"
  } else {
    "${Name}: present"
  }
}

function Convert-SecureStringToPlainText {
  param([Security.SecureString]$SecureValue)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Redact-PrivateRuntimeText {
  param(
    [string]$Text,
    [string]$PrivateBaseUrl,
    [string]$PrivateCredential
  )
  $redacted = $Text
  if (-not [string]::IsNullOrWhiteSpace($PrivateBaseUrl)) {
    $redacted = $redacted.Replace($PrivateBaseUrl, "[REDACTED_BASE_URL]")
  }
  if (-not [string]::IsNullOrWhiteSpace($PrivateCredential)) {
    $redacted = $redacted.Replace($PrivateCredential, "[REDACTED_CREDENTIAL]")
  }
  $redacted
}

function Write-SmokeAuditFiles {
  param(
    [string]$OutputDirectory,
    [string]$SummaryPath,
    [string]$StdoutPath,
    [string]$StderrPath,
    [int]$RunnerExitCode,
    [int]$SensitiveHitCount,
    [int]$ChapterCount,
    [int]$TokenBudget,
    [int]$TargetWordCount,
    [int]$ChapterWordCountMin,
    [int]$ChapterWordCountMax,
    [int]$TimeoutSeconds,
    [int]$TimeBudgetSeconds,
    [string]$Model
  )

  $summary = $null
  $summaryPresent = Test-Path -LiteralPath $SummaryPath
  if ($summaryPresent) {
    try {
      $summary = Get-Content -LiteralPath $SummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
      $summary = $null
    }
  }

  $metadata = [ordered]@{
    mode = "real_llm_smoke"
    generated_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
    output_directory = $OutputDirectory
    runner_exit_code = $RunnerExitCode
    summary_present = $summaryPresent
    sensitive_hit_count = $SensitiveHitCount
    redacted_parameters = [ordered]@{
      provider_protocol = "openai-compatible"
      model = $Model
      chapter_count = $ChapterCount
      token_budget = $TokenBudget
      target_word_count = $TargetWordCount
      chapter_word_count_min = $ChapterWordCountMin
      chapter_word_count_max = $ChapterWordCountMax
      timeout_seconds = $TimeoutSeconds
      time_budget_seconds = $TimeBudgetSeconds
    }
    files = [ordered]@{
      summary_json = $SummaryPath
      stdout_json = $StdoutPath
      stderr_log = $StderrPath
    }
  }

  if ($null -ne $summary) {
    $metadata.summary = [ordered]@{
      book_run_id = $summary.book_run_id
      book_run_status = $summary.book_run_status
      target_chapter_count = $summary.target_chapter_count
      actual_chapter_count = $summary.actual_chapter_count
      target_word_count = $summary.target_word_count
      tokens_used = $summary.tokens_used
      estimated_cost = $summary.estimated_cost
      actual_total_chars = $summary.actual_total_chars
      markdown_artifact_id = $summary.markdown_artifact_id
      audit_artifact_id = $summary.audit_artifact_id
      per_chapter_char_counts = $summary.per_chapter_char_counts
      per_chapter_metrics = $summary.per_chapter_metrics
    }
  }

  $metadataPath = Join-Path $OutputDirectory "run-metadata.json"
  $metadata | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

  $riskPath = Join-Path $OutputDirectory "quality-risk.md"
  $riskText = @"
# 真实 LLM smoke 质量风险记录

生成时间：$($metadata.generated_at)

## 脱敏运行参数

- provider_protocol: openai-compatible
- model: $Model
- chapter_count: $ChapterCount
- target_word_count: $TargetWordCount
- token_budget: $TokenBudget
- timeout_seconds: $TimeoutSeconds
- time_budget_seconds: $TimeBudgetSeconds

## 运行结果

- runner_exit_code: $RunnerExitCode
- summary_present: $summaryPresent
- sensitive_hit_count: $SensitiveHitCount
- tokens_used: $($metadata.summary.tokens_used)
- estimated_cost: $($metadata.summary.estimated_cost)
- actual_total_chars: $($metadata.summary.actual_total_chars)
- markdown_artifact_id: $($metadata.summary.markdown_artifact_id)
- audit_artifact_id: $($metadata.summary.audit_artifact_id)

## 质量风险

- 该产物只覆盖本次 smoke 的章节数，不能证明 10 章或 3-5 万字长程完成。
- 需要人工检查章节连贯性、重复段落、设定漂移、角色口吻、明显生成痕迹和结尾完整性。
- 如果 runner_exit_code 非 0、summary 缺失或 sensitive_hit_count 非 0，本次 smoke 不能进入后续 3 章门禁。
- 如果 token 消耗、字数或质量指标异常，需要先复盘 prompt、预算和 runner 输出，再决定是否扩大章节数。
"@
  Set-Content -LiteralPath $riskPath -Value $riskText -Encoding UTF8

  $todoPath = Join-Path $OutputDirectory "human-readthrough-todo.md"
  $todoText = @"
# 人工通读待办

生成时间：$($metadata.generated_at)

## 必读范围

- 本次章节数：$ChapterCount
- Markdown 产物 ID：$($metadata.summary.markdown_artifact_id)
- 审计报告 ID：$($metadata.summary.audit_artifact_id)

## 通读清单

- [ ] 核对每章是否有完整开端、推进和收束。
- [ ] 标记明显重复段落、空泛段落或模板化表达。
- [ ] 核对人物称谓、动机、关系和口吻是否前后一致。
- [ ] 核对时间线、地点、道具、伏笔和设定是否冲突。
- [ ] 核对爽点、悬念、转折和章节钩子是否有效。
- [ ] 核对是否存在不应写入成稿的系统提示、工具痕迹或模型自述。
- [ ] 给出人工结论：通过 / 需修订 / 退回重跑。

## 结论记录

- 人工通读人：
- 通读时间：
- 结论：
- 主要问题：
- 是否允许进入下一阶段：
"@
  Set-Content -LiteralPath $todoPath -Value $todoText -Encoding UTF8
}

Set-Location -LiteralPath "D:\StoryForge"

Write-Output "真实 LLM smoke 运行门禁"
Write-Output "章节数: $ChapterCount"
Write-Output "目标字数: $TargetWordCount"
Write-Output "token 预算: $TokenBudget"
Write-Output "单请求超时秒数: $TimeoutSeconds"
Write-Output "总时间预算秒数: $TimeBudgetSeconds"
Write-Output "中止条件: 缺少运行时变量、runner 非 0 退出、预算触顶、超时、summary.json 缺失或敏感扫描命中"
Write-Output "预期产物: summary.json、stdout.json、stderr.log，落盘到 .codex 下本次运行目录"

$baseUrl = Read-Host "请输入 OpenAI 兼容接口地址"
$secureCredential = Read-Host "请输入供应商凭据" -AsSecureString
$plainCredential = Convert-SecureStringToPlainText -SecureValue $secureCredential

try {
  $env:STORYFORGE_LLM_BASE_URL = $baseUrl
  $env:STORYFORGE_LLM_API_KEY = $plainCredential
  $env:STORYFORGE_LLM_MODEL = $Model
  $env:STORYFORGE_LLM_PROVIDER = "openai-compatible"
  $env:STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD = "1"
  $env:STORYFORGE_LLM_TIMEOUT_SECONDS = [string]$TimeoutSeconds
  $env:STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS = [string]$TimeBudgetSeconds
  $env:STORYFORGE_LLM_TEMPERATURE = "0.7"

  Test-Present "STORYFORGE_LLM_BASE_URL"
  Test-Present "STORYFORGE_LLM_API_KEY"
  Test-Present "STORYFORGE_LLM_MODEL"
  Test-Present "STORYFORGE_LLM_PROVIDER"
  Test-Present "STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD"

  $runId = Get-Date -Format "yyyyMMdd-HHmmss"
  $outDir = "D:\StoryForge\.codex\real-llm-${ChapterCount}ch-$runId"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null

  Set-Location -LiteralPath "D:\StoryForge\apps\api"
  $stdoutPath = Join-Path $outDir "stdout.json"
  $stderrPath = Join-Path $outDir "stderr.log"
  $summaryPath = Join-Path $outDir "summary.json"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "uv"
  $psi.WorkingDirectory = "D:\StoryForge\apps\api"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = @(
    "run",
    "python",
    "-m",
    "app.domains.book_runs.phase9b_real_llm_smoke",
    "--chapter-count",
    [string]$ChapterCount,
    "--token-budget",
    [string]$TokenBudget,
    "--target-word-count",
    [string]$TargetWordCount,
    "--chapter-word-count-min",
    [string]$ChapterWordCountMin,
    "--chapter-word-count-max",
    [string]$ChapterWordCountMax,
    "--summary-output",
    "`"$summaryPath`""
  ) -join " "

  $process = [System.Diagnostics.Process]::Start($psi)
  $stdoutText = $process.StandardOutput.ReadToEnd()
  $stderrText = $process.StandardError.ReadToEnd()
  $finished = $process.WaitForExit($TimeBudgetSeconds * 1000)
  if (-not $finished) {
    $process.Kill()
    $exitCode = 124
    $stderrText = $stderrText + "`n运行超出总时间预算，已中止。"
  } else {
    $exitCode = $process.ExitCode
  }

  $safeStdout = Redact-PrivateRuntimeText -Text $stdoutText -PrivateBaseUrl $baseUrl -PrivateCredential $plainCredential
  $safeStderr = Redact-PrivateRuntimeText -Text $stderrText -PrivateBaseUrl $baseUrl -PrivateCredential $plainCredential
  Set-Content -LiteralPath $stdoutPath -Value $safeStdout -Encoding UTF8
  Set-Content -LiteralPath $stderrPath -Value $safeStderr -Encoding UTF8

  Set-Location -LiteralPath "D:\StoryForge"
  $scanPatterns = @(
    [regex]::Escape($baseUrl),
    [regex]::Escape($plainCredential)
  )
  $scanFiles = @($stdoutPath, $stderrPath, $summaryPath) | Where-Object { Test-Path -LiteralPath $_ }
  $sensitiveHitCount = 0
  foreach ($file in $scanFiles) {
    $text = Get-Content -LiteralPath $file -Raw -Encoding UTF8
    foreach ($pattern in $scanPatterns) {
      if (-not [string]::IsNullOrWhiteSpace($pattern) -and [regex]::IsMatch($text, $pattern)) {
        $sensitiveHitCount += 1
      }
    }
  }

  Write-SmokeAuditFiles `
    -OutputDirectory $outDir `
    -SummaryPath $summaryPath `
    -StdoutPath $stdoutPath `
    -StderrPath $stderrPath `
    -RunnerExitCode $exitCode `
    -SensitiveHitCount $sensitiveHitCount `
    -ChapterCount $ChapterCount `
    -TokenBudget $TokenBudget `
    -TargetWordCount $TargetWordCount `
    -ChapterWordCountMin $ChapterWordCountMin `
    -ChapterWordCountMax $ChapterWordCountMax `
    -TimeoutSeconds $TimeoutSeconds `
    -TimeBudgetSeconds $TimeBudgetSeconds `
    -Model $Model

  Write-Output "真实 LLM smoke 产物目录: $outDir"
  Write-Output "runner_exit_code: $exitCode"
  if (Test-Path -LiteralPath $summaryPath) {
    Write-Output "summary.json: present"
  } else {
    Write-Output "summary.json: missing"
  }
  Write-Output "敏感扫描命中组数: $sensitiveHitCount"

  if ($exitCode -ne 0) {
    exit $exitCode
  }
  if (-not (Test-Path -LiteralPath $summaryPath)) {
    exit 10
  }
  if ($sensitiveHitCount -ne 0) {
    exit 11
  }
} finally {
  $plainCredential = $null
  $env:STORYFORGE_LLM_API_KEY = $null
}
