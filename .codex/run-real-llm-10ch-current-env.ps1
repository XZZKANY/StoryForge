param(
  [int]$ChapterCount = 10,
  [int]$MaxChapterCount = 30,
  [int]$TargetWordCount = 9000,
  [int]$TokenBudget = 200000,
  [int]$ChapterWordCountMin = 600,
  [int]$ChapterWordCountMax = 1600,
  [int]$TimeoutSeconds = 300,
  [int]$TimeBudgetSeconds = 4200,
  [int]$OuterTimeoutSeconds = 4800,
  [string]$Label = "10ch",
  [string]$ResumeRunDirectory = "",
  [switch]$ProbeOnly,
  [switch]$Interactive
)

$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText {
  param([Security.SecureString]$SecureValue)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Set-InteractiveRuntimeEnv {
  param(
    [string]$Name,
    [string]$Value
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
  if (-not $script:interactiveInjectedNames.Contains($Name)) {
    [void]$script:interactiveInjectedNames.Add($Name)
  }
}

function Clear-InteractiveRuntimeEnv {
  foreach ($name in $script:interactiveInjectedNames) {
    if ($name -eq "STORYFORGE_LLM_API_KEY") {
      $env:STORYFORGE_LLM_API_KEY = $null
    } else {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
  }
  $script:plainInteractiveCredential = $null
  $script:secureInteractiveCredential = $null
}

$requiredNames = @(
  "STORYFORGE_LLM_API_KEY",
  "STORYFORGE_LLM_BASE_URL",
  "STORYFORGE_LLM_MODEL",
  "STORYFORGE_LLM_PROVIDER",
  "STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD"
)

$interactiveInjectedNames = [System.Collections.Generic.List[string]]::new()
$secureInteractiveCredential = $null
$plainInteractiveCredential = $null

if ($Interactive) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_BASE_URL", "Process"))) {
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_BASE_URL" -Value (Read-Host "请输入 OpenAI 兼容接口地址")
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_API_KEY", "Process"))) {
    $secureInteractiveCredential = Read-Host "请输入供应商凭据" -AsSecureString
    $plainInteractiveCredential = Convert-SecureStringToPlainText -SecureValue $secureInteractiveCredential
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_API_KEY" -Value $plainInteractiveCredential
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_MODEL", "Process"))) {
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_MODEL" -Value (Read-Host "请输入要运行的模型 ID")
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_PROVIDER", "Process"))) {
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_PROVIDER" -Value (Read-Host "请输入 provider 标识，通常为 openai-compatible")
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD", "Process"))) {
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD" -Value (Read-Host "请输入 1 确认本线程使用真实 LLM 运行时配置")
  }
}

$missing = @()
foreach ($name in $requiredNames) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    $missing += $name
  }
}

Write-Output "真实 LLM 10 章运行包装"
Write-Output "env_scope: current_process"
Write-Output "chapter_count: $ChapterCount"
Write-Output "max_chapter_count: $MaxChapterCount"
Write-Output "target_word_count: $TargetWordCount"
Write-Output "token_budget: $TokenBudget"
Write-Output "timeout_seconds: $TimeoutSeconds"
Write-Output "time_budget_seconds: $TimeBudgetSeconds"
Write-Output "outer_timeout_seconds: $OuterTimeoutSeconds"
if (-not [string]::IsNullOrWhiteSpace($ResumeRunDirectory)) {
  Write-Output "resume_run_directory: $ResumeRunDirectory"
}
Write-Output "probe_only: $ProbeOnly"
Write-Output "interactive: $Interactive"

if ($missing.Count -gt 0) {
  Write-Output "missing_env=$($missing -join ',')"
  Write-Output "gate: fail_preflight"
  Write-Output "note: 请在同一个 PowerShell 进程中注入运行时变量，或追加 -Interactive 后手动输入；不要把凭据写入文件。"
  Clear-InteractiveRuntimeEnv
  exit 2
}

try {
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $apiRoot = Join-Path $repoRoot "apps\api"
  $runnerPath = Join-Path $repoRoot ".codex\run-real-llm-long-direct.py"
  $connectivityProbePath = Join-Path $repoRoot ".codex\run-real-llm-connectivity-probe.ps1"

  Write-Output "connectivity_probe: start"
  $probeOutput = & powershell -ExecutionPolicy Bypass -File $connectivityProbePath -TimeoutSeconds ([Math]::Min($TimeoutSeconds, 30)) 2>&1
  $probeExitCode = $LASTEXITCODE
  $probeOutput | ForEach-Object { Write-Output $_ }
  Write-Output "connectivity_probe_exit_code: $probeExitCode"

  if ($probeExitCode -ne 0 -or -not (($probeOutput -join "`n") -match "gate:\s*pass_connectivity_probe")) {
    Write-Output "gate: fail_connectivity_probe"
    Write-Output "note: Provider 连通性探针未通过，已停止 10 章长程运行。"
    exit $probeExitCode
  }

  if ($ProbeOnly) {
    Write-Output "gate: pass_probe_only"
    Write-Output "note: Provider 连通性探针已通过，ProbeOnly 模式不会启动 10 章长程。"
    exit 0
  }

  Push-Location $apiRoot
  try {
    $runnerArgs = @(
      $runnerPath,
      "--chapter-count", $ChapterCount,
      "--max-chapter-count", $MaxChapterCount,
      "--target-word-count", $TargetWordCount,
      "--token-budget", $TokenBudget,
      "--chapter-word-count-min", $ChapterWordCountMin,
      "--chapter-word-count-max", $ChapterWordCountMax,
      "--timeout-seconds", $TimeoutSeconds,
      "--time-budget-seconds", $TimeBudgetSeconds,
      "--outer-timeout-seconds", $OuterTimeoutSeconds,
      "--label", $Label
    )
    if (-not [string]::IsNullOrWhiteSpace($ResumeRunDirectory)) {
      $runnerArgs += @("--resume-run-directory", $ResumeRunDirectory)
    }
    uv run python @runnerArgs
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  Clear-InteractiveRuntimeEnv
}
