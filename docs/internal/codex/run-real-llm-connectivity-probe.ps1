param(
  [string]$Model = "",
  [int]$TimeoutSeconds = 20,
  [switch]$Interactive
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

function Join-ProviderPath {
  param(
    [string]$BaseUrl,
    [string]$Path
  )
  $normalizedBase = $BaseUrl.Trim().TrimEnd("/")
  $normalizedPath = $Path.TrimStart("/")
  "$normalizedBase/$normalizedPath"
}

function Invoke-ProviderJson {
  param(
    [string]$Uri,
    [string]$Method,
    [hashtable]$Headers,
    [object]$Body,
    [int]$TimeoutSeconds
  )
  $startedAt = Get-Date
  try {
    $parameters = @{
      Uri = $Uri
      Method = $Method
      Headers = $Headers
      TimeoutSec = $TimeoutSeconds
      ErrorAction = "Stop"
    }
    if ($null -ne $Body) {
      $parameters.Body = ($Body | ConvertTo-Json -Depth 8)
      $parameters.ContentType = "application/json"
    }
    $payload = Invoke-RestMethod @parameters
    [ordered]@{
      ok = $true
      status = "ok"
      latency_ms = [int](((Get-Date) - $startedAt).TotalMilliseconds)
      payload = $payload
    }
  } catch {
    [ordered]@{
      ok = $false
      status = "failed"
      latency_ms = [int](((Get-Date) - $startedAt).TotalMilliseconds)
      error_type = $_.Exception.GetType().Name
      error_message = $_.Exception.Message
    }
  }
}

function Read-ModelIds {
  param([object]$Payload)
  $models = @()
  if ($null -ne $Payload -and $null -ne $Payload.data) {
    foreach ($item in $Payload.data) {
      if ($null -ne $item.id -and -not [string]::IsNullOrWhiteSpace([string]$item.id)) {
        $models += [string]$item.id
      }
    }
  }
  $models | Sort-Object -Unique
}

$baseUrl = [Environment]::GetEnvironmentVariable("STORYFORGE_LLM_BASE_URL", "Process")
$plainCredential = [Environment]::GetEnvironmentVariable("STORYFORGE_LLM_API_KEY", "Process")
$modelFromEnv = [Environment]::GetEnvironmentVariable("STORYFORGE_LLM_MODEL", "Process")

if ([string]::IsNullOrWhiteSpace($Model)) {
  $Model = $modelFromEnv
}

if ($Interactive) {
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    $baseUrl = Read-Host "请输入 OpenAI 兼容接口地址"
  }
  if ([string]::IsNullOrWhiteSpace($plainCredential)) {
    $secureCredential = Read-Host "请输入供应商凭据" -AsSecureString
    $plainCredential = Convert-SecureStringToPlainText -SecureValue $secureCredential
  }
  if ([string]::IsNullOrWhiteSpace($Model)) {
    $Model = Read-Host "请输入要探测的模型 ID"
  }
}

try {
  Write-Output "真实 LLM 低成本连通性探针"
  Write-Output "env_scope: current_process_or_interactive"
  Write-Output "timeout_seconds: $TimeoutSeconds"
  Test-Present "STORYFORGE_LLM_BASE_URL"
  Test-Present "STORYFORGE_LLM_API_KEY"
  if ([string]::IsNullOrWhiteSpace($Model)) {
    Write-Output "STORYFORGE_LLM_MODEL: missing"
  } else {
    Write-Output "STORYFORGE_LLM_MODEL: present"
  }

  $missing = @()
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    $missing += "STORYFORGE_LLM_BASE_URL"
  }
  if ([string]::IsNullOrWhiteSpace($plainCredential)) {
    $missing += "STORYFORGE_LLM_API_KEY"
  }
  if ([string]::IsNullOrWhiteSpace($Model)) {
    $missing += "STORYFORGE_LLM_MODEL"
  }
  if ($missing.Count -gt 0) {
    Write-Output "missing_env=$($missing -join ',')"
    Write-Output "gate: fail_preflight"
    Write-Output "note: 请在同一个 PowerShell 进程设置运行时变量，或追加 -Interactive 后手动输入；不要把凭据写入文件。"
    exit 2
  }

  $authHeader = [Environment]::GetEnvironmentVariable("STORYFORGE_LLM_AUTH_HEADER", "Process")
  if ([string]::IsNullOrWhiteSpace($authHeader)) {
    $authHeader = "api-key"
  }
  $headers = @{
    Accept = "application/json"
  }
  if ($authHeader.Trim().ToLowerInvariant() -eq "api-key") {
    $headers["api-key"] = $plainCredential
  } elseif ($authHeader.Trim().ToLowerInvariant() -eq "bearer") {
    $headers["Authorization"] = "Bearer $plainCredential"
  } else {
    Write-Output "gate: fail_preflight"
    Write-Output "failure: STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer"
    exit 2
  }
  $modelsUri = Join-ProviderPath -BaseUrl $baseUrl -Path "/models"
  $chatUri = Join-ProviderPath -BaseUrl $baseUrl -Path "/chat/completions"

  $modelsResult = Invoke-ProviderJson -Uri $modelsUri -Method "GET" -Headers $headers -Body $null -TimeoutSeconds $TimeoutSeconds
  Write-Output "models_probe: $($modelsResult.status)"
  Write-Output "models_latency_ms: $($modelsResult.latency_ms)"
  $availableModels = @()
  if ($modelsResult.ok) {
    $availableModels = @(Read-ModelIds -Payload $modelsResult.payload)
    Write-Output "models_count: $($availableModels.Count)"
    if ($availableModels -contains $Model) {
      Write-Output "model_available: true"
    } else {
      Write-Output "model_available: false"
    }
  } else {
    $safeMessage = Redact-PrivateRuntimeText -Text $modelsResult.error_message -PrivateBaseUrl $baseUrl -PrivateCredential $plainCredential
    Write-Output "models_error_type: $($modelsResult.error_type)"
    Write-Output "models_error_message: $safeMessage"
  }

  $chatBody = @{
    model = $Model
    messages = @(
      @{ role = "system"; content = "You are a connectivity probe. Reply with OK only." },
      @{ role = "user"; content = "OK" }
    )
    temperature = 0
    max_completion_tokens = 64
  }
  $chatResult = Invoke-ProviderJson -Uri $chatUri -Method "POST" -Headers $headers -Body $chatBody -TimeoutSeconds $TimeoutSeconds
  Write-Output "chat_probe: $($chatResult.status)"
  Write-Output "chat_latency_ms: $($chatResult.latency_ms)"
  if ($chatResult.ok) {
    $content = $chatResult.payload.choices[0].message.content
  } else {
    $safeMessage = Redact-PrivateRuntimeText -Text $chatResult.error_message -PrivateBaseUrl $baseUrl -PrivateCredential $plainCredential
    Write-Output "chat_error_type: $($chatResult.error_type)"
    Write-Output "chat_error_message: $safeMessage"
    $content = ""
  }
  if ([string]::IsNullOrWhiteSpace([string]$content)) {
      Write-Output "chat_content: empty"
      Write-Output "chat_empty_retry: start"
      $chatRetryBody = @{
        model = $Model
        messages = @(
          @{ role = "system"; content = "You are a strict connectivity probe. Output exactly the text OK. Do not explain." },
          @{ role = "user"; content = "Return exactly: OK" }
        )
        temperature = 0
        max_completion_tokens = 256
      }
      $chatRetryResult = Invoke-ProviderJson -Uri $chatUri -Method "POST" -Headers $headers -Body $chatRetryBody -TimeoutSeconds $TimeoutSeconds
      Write-Output "chat_retry_probe: $($chatRetryResult.status)"
      Write-Output "chat_retry_latency_ms: $($chatRetryResult.latency_ms)"
      if ($chatRetryResult.ok) {
        $retryContent = $chatRetryResult.payload.choices[0].message.content
        if ([string]::IsNullOrWhiteSpace([string]$retryContent)) {
          Write-Output "chat_retry_content: empty"
          Write-Output "gate: fail_empty_chat"
          exit 3
        }
        Write-Output "chat_retry_content: present"
      } else {
        $safeMessage = Redact-PrivateRuntimeText -Text $chatRetryResult.error_message -PrivateBaseUrl $baseUrl -PrivateCredential $plainCredential
        Write-Output "chat_retry_error_type: $($chatRetryResult.error_type)"
        Write-Output "chat_retry_error_message: $safeMessage"
        Write-Output "gate: fail_chat"
        exit 4
      }
  } else {
    Write-Output "chat_content: present"
  }

  Write-Output "gate: pass_connectivity_probe"
  exit 0
} finally {
  $plainCredential = $null
  $secureCredential = $null
  $env:STORYFORGE_LLM_API_KEY = $null
}
