$ErrorActionPreference = "Continue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Failed = $false

function Write-Ok {
    param([string]$Message)
    Write-Host "[通过] $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[失败] $Message" -ForegroundColor Red
    $script:Failed = $true
}

function Test-CommandAvailable {
    param(
        [string]$CommandName,
        [string]$DisplayName
    )

    if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
        Write-Ok "$DisplayName 已安装。"
    } else {
        Write-Fail "未找到 $DisplayName，请先安装后再运行本地验证。"
    }
}

function Test-PythonRuntime {
    $Candidates = @(
        @{ Executable = "python"; Arguments = @(); DisplayName = "python" },
        @{ Executable = "python3"; Arguments = @(); DisplayName = "python3" },
        @{ Executable = "py"; Arguments = @("-3.12"); DisplayName = "py -3.12" },
        @{ Executable = "py"; Arguments = @("-3.11"); DisplayName = "py -3.11" }
    )

    foreach ($Candidate in $Candidates) {
        $Executable = $Candidate.Executable
        $Arguments = $Candidate.Arguments
        $DisplayName = $Candidate.DisplayName

        if (-not (Get-Command $Executable -ErrorAction SilentlyContinue)) {
            continue
        }

        $Output = & $Executable @Arguments --version 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            continue
        }

        if ($Output -match "Python\s+(\d+)\.(\d+)\.(\d+)") {
            $Major = [int]$Matches[1]
            $Minor = [int]$Matches[2]
            $Patch = [int]$Matches[3]
            $VersionText = "$Major.$Minor.$Patch"

            if (($Major -gt 3) -or (($Major -eq 3) -and ($Minor -ge 11))) {
                Write-Ok "Python 运行时满足要求：$DisplayName -> Python $VersionText。"
                return
            }

            Write-Host "[跳过] $DisplayName -> Python $VersionText，低于项目要求的 Python 3.11。" -ForegroundColor Yellow
        }
    }

    Write-Fail "未找到 Python 3.11 或更高版本。请安装 Python 3.11+，或确认 py -3.12 / py -3.11 可用。"
}

function Test-RequiredPath {
    param([string]$RelativePath)

    $FullPath = Join-Path $Root $RelativePath
    if (Test-Path -LiteralPath $FullPath) {
        Write-Ok "已找到 $RelativePath。"
    } else {
        Write-Fail "缺少必需文件或目录：$RelativePath。"
    }
}

function Test-RuntimeDiagnosticsGate {
    $E2eScriptRelativePath = "scripts/run-e2e.mjs"
    $E2eScriptPath = Join-Path $Root $E2eScriptRelativePath
    if (-not (Test-Path -LiteralPath $E2eScriptPath)) {
        Write-Fail "缺少 Runtime 诊断门禁脚本：$E2eScriptRelativePath。"
        return
    }

    $E2eScriptContent = Get-Content -LiteralPath $E2eScriptPath -Raw -Encoding UTF8
    $RequiredTargets = @(
        "tests/e2e/phase5-runtime-diagnostics.spec.ts",
        "tests/test_model_runs.py",
        "tests/test_runtime_tools.py",
        "tests/test_workflow_session.py",
        "tests/test_workflow_lifecycle.py",
        "tests/test_provider_adapter.py",
        "tests/test_provider_parity_harness.py",
        "tests/test_creative_tool_registry.py"
    )

    foreach ($Target in $RequiredTargets) {
        if ($E2eScriptContent -like "*$Target*") {
            Write-Ok "Runtime 诊断门禁已纳入 $Target。"
        } else {
            Write-Fail "Runtime 诊断门禁缺少 $Target，请更新 $E2eScriptRelativePath。"
        }
    }
}

function Test-OpenApiRuntimeContractGate {
    $OpenApiScriptRelativePath = "scripts/generate-openapi.ps1"
    $E2eScriptRelativePath = "scripts/run-e2e.mjs"
    $SharedOpenApiRelativePath = "packages/shared/src/contracts/storyforge.openapi.json"
    $OpenApiScriptPath = Join-Path $Root $OpenApiScriptRelativePath
    $E2eScriptPath = Join-Path $Root $E2eScriptRelativePath
    $SharedOpenApiPath = Join-Path $Root $SharedOpenApiRelativePath

    foreach ($RequiredPath in @($OpenApiScriptPath, $E2eScriptPath, $SharedOpenApiPath)) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            Write-Fail "OpenAPI Runtime 契约门禁缺少文件：$RequiredPath。"
            return
        }
    }

    $OpenApiScriptContent = Get-Content -LiteralPath $OpenApiScriptPath -Raw -Encoding UTF8
    $E2eScriptContent = Get-Content -LiteralPath $E2eScriptPath -Raw -Encoding UTF8
    $SharedOpenApiContent = Get-Content -LiteralPath $SharedOpenApiPath -Raw -Encoding UTF8
    $RequiredMarkers = @(
        @{ Source = $OpenApiScriptContent; Marker = "app.openapi()"; Display = $OpenApiScriptRelativePath },
        @{ Source = $OpenApiScriptContent; Marker = $SharedOpenApiRelativePath; Display = $OpenApiScriptRelativePath },
        @{ Source = $E2eScriptContent; Marker = "refreshOpenApiContract"; Display = $E2eScriptRelativePath },
        @{ Source = $E2eScriptContent; Marker = $SharedOpenApiRelativePath; Display = $E2eScriptRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"RuntimeToolRead"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"RunsRuntimeDiagnosticsRead"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"RunsJobRunRead"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"ModelRunRead"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"/api/runtime-tools"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"/api/model-runs"'; Display = $SharedOpenApiRelativePath },
        @{ Source = $SharedOpenApiContent; Marker = '"runtime_diagnostics"'; Display = $SharedOpenApiRelativePath }
    )

    foreach ($Requirement in $RequiredMarkers) {
        if ($Requirement.Source -like "*$($Requirement.Marker)*") {
            Write-Ok "OpenAPI Runtime 契约门禁已确认 $($Requirement.Display) 包含 $($Requirement.Marker)。"
        } else {
            Write-Fail "OpenAPI Runtime 契约门禁缺少 $($Requirement.Marker)，请检查 $($Requirement.Display)。"
        }
    }
}

function Test-DockerContainerRunning {
    param(
        [string]$ContainerName,
        [string]$DisplayName
    )

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "无法检查 $DisplayName 容器，因为 Docker 命令不可用。"
        return
    }

    $ContainerId = docker ps --filter "name=^/$ContainerName$" --filter "status=running" --quiet 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "无法查询 $DisplayName 容器状态，请确认 Docker Desktop 或 Docker 服务已启动，然后执行 docker compose up -d postgres redis minio。"
        return
    }

    if ($ContainerId) {
        Write-Ok "$DisplayName 容器正在运行。"
    } else {
        Write-Fail "$DisplayName 容器未运行，请执行 docker compose up -d postgres redis minio。"
    }
}

Write-Host "开始执行 StoryForge 本地验证。" -ForegroundColor Cyan

Test-CommandAvailable -CommandName "node" -DisplayName "Node.js"
Test-CommandAvailable -CommandName "pnpm" -DisplayName "pnpm"
Test-PythonRuntime
Test-CommandAvailable -CommandName "docker" -DisplayName "Docker"

Test-RequiredPath "docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md"
Test-RequiredPath "package.json"
Test-RequiredPath "pnpm-workspace.yaml"
Test-RequiredPath "docker-compose.yml"
Test-RequiredPath ".env.example"
Test-RequiredPath "apps/web/package.json"
Test-RequiredPath "apps/api/pyproject.toml"
Test-RequiredPath "apps/workflow/pyproject.toml"
Test-RequiredPath "packages/shared/package.json"

Test-RuntimeDiagnosticsGate
Test-OpenApiRuntimeContractGate

Test-DockerContainerRunning -ContainerName "storyforge-postgres" -DisplayName "PostgreSQL"
Test-DockerContainerRunning -ContainerName "storyforge-redis" -DisplayName "Redis"
Test-DockerContainerRunning -ContainerName "storyforge-minio" -DisplayName "MinIO"

if ($Failed) {
    Write-Host "StoryForge 本地验证失败，请先修复以上问题。" -ForegroundColor Red
    exit 1
}

Write-Host "StoryForge 本地验证通过。" -ForegroundColor Green
exit 0