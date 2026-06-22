param(
    [switch]$RunDockerBuild
)

$ErrorActionPreference = "Continue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Failed = $false

function Get-LogTimestamp {
    return (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
}

function Write-Info {
    param([string]$Message)
    Write-Host "[$(Get-LogTimestamp)] [INFO] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[$(Get-LogTimestamp)] [WARN] $Message" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[$(Get-LogTimestamp)] [OK] [通过] $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[$(Get-LogTimestamp)] [ERROR] [失败] $Message" -ForegroundColor Red
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

            Write-Warn "$DisplayName -> Python $VersionText，低于项目要求的 Python 3.11。"
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

function Invoke-DockerComposeConfig {
    $Output = & docker compose -f docker-compose.yml -f docker-compose.prod.yml config 2>&1 | Out-String
    $ExitCode = $LASTEXITCODE
    return @{
        ExitCode = $ExitCode
        Output = $Output
    }
}

function Test-DockerProdComposeConfig {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "无法验证生产 Docker Compose 配置，因为 Docker 命令不可用。"
        return
    }

    Push-Location $Root
    try {
        $Result = Invoke-DockerComposeConfig
    } finally {
        Pop-Location
    }

    if ($Result.ExitCode -ne 0) {
        Write-Fail "生产 Docker Compose 配置渲染失败：$($Result.Output.Trim())"
        return
    }

    Write-Ok "生产 Docker Compose 配置可通过 docker compose config 渲染。"

    $ForbiddenPublishedPorts = @('published: "55432"', 'published: "6379"', 'published: "9000"', 'published: "9001"')
    foreach ($PortMarker in $ForbiddenPublishedPorts) {
        if ($Result.Output -like "*$PortMarker*") {
            Write-Fail "生产 Docker Compose 配置不应暴露基础服务端口：$PortMarker。"
        } else {
            Write-Ok "生产 Docker Compose 配置未暴露基础服务端口：$PortMarker。"
        }
    }

    $ForbiddenSecrets = @(
        'STORYFORGE_API_KEY: local-dev-key',
        'STORYFORGE_API_KEY: CHANGE_ME',
        'STORYFORGE_JWT_SECRET: CHANGE_ME',
        'S3_SECRET_KEY: storyforge-dev-only',
        'S3_SECRET_KEY: CHANGE_ME'
    )
    foreach ($SecretMarker in $ForbiddenSecrets) {
        if ($Result.Output -like "*$SecretMarker*") {
            Write-Fail "生产 Docker Compose 配置包含禁止的凭据或占位值：$SecretMarker。"
        } else {
            Write-Ok "生产 Docker Compose 配置未包含禁止凭据标记：$SecretMarker。"
        }
    }

    if ($Result.Output -like "*REDIS_URL:*" -or $Result.Output -like "*STORYFORGE_RATE_LIMIT_REDIS_URL:*") {
        Write-Ok "生产 Docker Compose 配置包含共享限流 Redis 来源。"
    } else {
        Write-Fail "生产 Docker Compose 配置缺少 REDIS_URL 或 STORYFORGE_RATE_LIMIT_REDIS_URL，无法支撑多 worker 全局限流。"
    }
}

function Test-DockerComposeBuildGate {
    $ComposePath = Join-Path $Root "docker-compose.yml"
    $RequiredDockerfiles = @(
        "apps/api/Dockerfile",
        "apps/workflow/Dockerfile"
    )

    if (-not (Test-Path -LiteralPath $ComposePath)) {
        Write-Fail "缺少 Docker Compose 构建配置：docker-compose.yml。"
        return
    }

    $ComposeContent = Get-Content -LiteralPath $ComposePath -Raw -Encoding UTF8
    foreach ($Marker in @("context: ./apps/api", "context: ./apps/workflow")) {
        if ($ComposeContent -like "*$Marker*") {
            Write-Ok "Docker build 门禁已确认 compose 包含 $Marker。"
        } else {
            Write-Fail "Docker build 门禁缺少 compose 标记：$Marker。"
        }
    }

    foreach ($Dockerfile in $RequiredDockerfiles) {
        $DockerfilePath = Join-Path $Root $Dockerfile
        if (Test-Path -LiteralPath $DockerfilePath) {
            Write-Ok "Docker build 门禁已找到 $Dockerfile。"
        } else {
            Write-Fail "Docker build 门禁缺少 $Dockerfile。"
        }
    }

    if (-not $RunDockerBuild) {
        Write-Info "跳过实际 Docker 镜像构建；如需执行，请追加 -RunDockerBuild。"
        return
    }

    Push-Location $Root
    try {
        & docker compose -f docker-compose.yml -f docker-compose.prod.yml build api workflow
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Docker build 门禁通过：api、workflow 镜像可构建。"
        } else {
            Write-Fail "Docker build 门禁失败：api、workflow 镜像构建退出码 $LASTEXITCODE。"
        }
    } finally {
        Pop-Location
    }
}

function Test-DockerComposeHealthGate {
    $ComposeContent = Get-Content -LiteralPath (Join-Path $Root "docker-compose.yml") -Raw -Encoding UTF8
    $ProdComposeContent = Get-Content -LiteralPath (Join-Path $Root "docker-compose.prod.yml") -Raw -Encoding UTF8
    $ApiDockerfileContent = Get-Content -LiteralPath (Join-Path $Root "apps/api/Dockerfile") -Raw -Encoding UTF8

    $RequiredMarkers = @(
        @{ Source = $ComposeContent; Marker = "http://localhost:8000/health/live"; Display = "docker-compose.yml API healthcheck" },
        @{ Source = $ProdComposeContent; Marker = "condition: service_healthy"; Display = "docker-compose.prod.yml service_healthy 依赖" },
        @{ Source = $ApiDockerfileContent; Marker = "HEALTHCHECK"; Display = "apps/api/Dockerfile healthcheck" },
        @{ Source = $ApiDockerfileContent; Marker = "http://127.0.0.1:8000/health/live"; Display = "apps/api/Dockerfile liveness 探针" }
    )

    foreach ($Requirement in $RequiredMarkers) {
        if ($Requirement.Source -like "*$($Requirement.Marker)*") {
            Write-Ok "Docker health 门禁已确认 $($Requirement.Display)。"
        } else {
            Write-Fail "Docker health 门禁缺少 $($Requirement.Display)：$($Requirement.Marker)。"
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

Write-Info "开始执行 StoryForge 本地验证。"

Test-CommandAvailable -CommandName "node" -DisplayName "Node.js"
Test-CommandAvailable -CommandName "pnpm" -DisplayName "pnpm"
Test-PythonRuntime
Test-CommandAvailable -CommandName "docker" -DisplayName "Docker"

Test-RequiredPath "docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md"
Test-RequiredPath "package.json"
Test-RequiredPath "pnpm-workspace.yaml"
Test-RequiredPath "docker-compose.yml"
Test-RequiredPath ".env.example"
Test-RequiredPath "apps/desktop/package.json"
Test-RequiredPath "apps/desktop/frontend/package.json"
Test-RequiredPath "apps/api/pyproject.toml"
Test-RequiredPath "apps/workflow/pyproject.toml"
Test-RequiredPath "packages/shared/package.json"

Test-RuntimeDiagnosticsGate
Test-OpenApiRuntimeContractGate
Test-DockerProdComposeConfig
Test-DockerComposeBuildGate
Test-DockerComposeHealthGate

Test-DockerContainerRunning -ContainerName "storyforge-postgres" -DisplayName "PostgreSQL"
Test-DockerContainerRunning -ContainerName "storyforge-redis" -DisplayName "Redis"
Test-DockerContainerRunning -ContainerName "storyforge-minio" -DisplayName "MinIO"

if ($Failed) {
    Write-Fail "StoryForge 本地验证失败，请先修复以上问题。"
    exit 1
}

Write-Ok "StoryForge 本地验证通过。"
exit 0
