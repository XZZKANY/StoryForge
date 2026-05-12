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

function Test-RequiredPath {
    param([string]$RelativePath)

    $FullPath = Join-Path $Root $RelativePath
    if (Test-Path -LiteralPath $FullPath) {
        Write-Ok "已找到 $RelativePath。"
    } else {
        Write-Fail "缺少必需文件或目录：$RelativePath。"
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
        Write-Fail "无法查询 Docker 容器状态，请确认 Docker 服务已启动。"
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
Test-CommandAvailable -CommandName "python" -DisplayName "Python"
Test-CommandAvailable -CommandName "docker" -DisplayName "Docker"

Test-RequiredPath "docs/superpowers/plans/2026-05-12-storyforge-phase1-engineering-plan.md"
Test-RequiredPath "docs/superpowers/specs/2026-05-12-dual-mode-ai-novel-platform-design.zh-CN.md"
Test-RequiredPath "package.json"
Test-RequiredPath "pnpm-workspace.yaml"
Test-RequiredPath "docker-compose.yml"
Test-RequiredPath ".env.example"
Test-RequiredPath "apps/web/package.json"
Test-RequiredPath "apps/api/pyproject.toml"
Test-RequiredPath "apps/workflow/pyproject.toml"
Test-RequiredPath "packages/shared/package.json"

Test-DockerContainerRunning -ContainerName "storyforge-postgres" -DisplayName "PostgreSQL"
Test-DockerContainerRunning -ContainerName "storyforge-redis" -DisplayName "Redis"

if ($Failed) {
    Write-Host "StoryForge 本地验证失败，请先修复以上问题。" -ForegroundColor Red
    exit 1
}

Write-Host "StoryForge 本地验证通过。" -ForegroundColor Green
exit 0