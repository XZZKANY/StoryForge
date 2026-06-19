param(
  [int]$TimeoutSeconds = 120,
  [string]$ReasoningEffort = "",
  [switch]$Matrix,
  [switch]$Interactive
)

# 单发探针包装：用真实创作 prompt 打一发 _call_llm，把 mimo 失败模式（HTTP 500 / 超时 / 空返回）钉死。
# 与其它 .codex/*.ps1 一致：凭据只在当前进程注入，绝不落盘。
# 默认跑一次当前配置；-Matrix 跑 A/B 矩阵（示例 on/off × reasoning_effort minimal/unset）以定位根因与改法。

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

$script:interactiveInjectedNames = [System.Collections.Generic.List[string]]::new()

function Set-InteractiveRuntimeEnv {
  param([string]$Name, [string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return }
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
}

$requiredNames = @(
  "STORYFORGE_LLM_API_KEY",
  "STORYFORGE_LLM_BASE_URL",
  "STORYFORGE_LLM_MODEL",
  "STORYFORGE_LLM_PROVIDER",
  "STORYFORGE_LLM_CONFIG_CONFIRMED_THIS_THREAD"
)

if ($Interactive) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_BASE_URL", "Process"))) {
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_BASE_URL" -Value (Read-Host "请输入 OpenAI 兼容接口地址")
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("STORYFORGE_LLM_API_KEY", "Process"))) {
    $secure = Read-Host "请输入供应商凭据" -AsSecureString
    Set-InteractiveRuntimeEnv -Name "STORYFORGE_LLM_API_KEY" -Value (Convert-SecureStringToPlainText -SecureValue $secure)
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

Write-Output "真实 LLM 单发探针包装"
Write-Output "env_scope: current_process"
Write-Output "timeout_seconds: $TimeoutSeconds"
Write-Output "matrix: $Matrix"
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
  $probePath = Join-Path $repoRoot ".codex\run-real-llm-single-shot-probe.py"

  # 矩阵：(examples, reasoning_effort) 组合，用于区分"示例触发 500" vs "超长推理/超时"。
  if ($Matrix) {
    $cases = @(
      @{ examples = "1"; effort = "" },
      @{ examples = "0"; effort = "" },
      @{ examples = "1"; effort = "minimal" },
      @{ examples = "0"; effort = "minimal" }
    )
  } else {
    $cases = @(@{ examples = "1"; effort = $ReasoningEffort })
  }

  Push-Location $apiRoot
  try {
    $env:STORYFORGE_LLM_TIMEOUT_SECONDS = "$TimeoutSeconds"
    foreach ($case in $cases) {
      $env:PROBE_INCLUDE_CRAFT_EXAMPLES = $case.examples
      if ([string]::IsNullOrWhiteSpace($case.effort)) {
        [Environment]::SetEnvironmentVariable("STORYFORGE_LLM_REASONING_EFFORT", $null, "Process")
        $effortLabel = "unset"
      } else {
        $env:STORYFORGE_LLM_REASONING_EFFORT = $case.effort
        $effortLabel = $case.effort
      }
      Write-Output "---- case: examples=$($case.examples) reasoning_effort=$effortLabel ----"
      uv run python $probePath
      Write-Output "case_exit_code: $LASTEXITCODE"
    }
    Write-Output "gate: pass_single_shot_probe"
    exit 0
  } finally {
    Pop-Location
    $env:PROBE_INCLUDE_CRAFT_EXAMPLES = $null
    [Environment]::SetEnvironmentVariable("STORYFORGE_LLM_REASONING_EFFORT", $null, "Process")
  }
} finally {
  Clear-InteractiveRuntimeEnv
}
