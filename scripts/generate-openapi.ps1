$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ApiRoot = Join-Path $Root "apps/api"
$OutputPath = Join-Path $Root "packages/shared/src/contracts/storyforge.openapi.json"
$OutputDirectory = Split-Path -Parent $OutputPath

function Resolve-PythonCommand {
    if (Get-Command "uv" -ErrorAction SilentlyContinue) {
        return @{ Command = "uv"; Arguments = @("run", "python", "-"); DisplayName = "uv run python" }
    }

    if (Get-Command "python3" -ErrorAction SilentlyContinue) {
        return @{ Command = "python3"; Arguments = @("-"); DisplayName = "python3" }
    }

    if (Get-Command "python" -ErrorAction SilentlyContinue) {
        return @{ Command = "python"; Arguments = @("-"); DisplayName = "python" }
    }

    throw "未找到 uv、python3 或 python，无法生成 OpenAPI 契约。"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$Python = Resolve-PythonCommand
Write-Host "使用 $($Python.DisplayName) 生成 OpenAPI 契约。" -ForegroundColor Cyan

Push-Location $ApiRoot
try {
    $pythonCode = @"
import json
from pathlib import Path
from app.main import app

output_path = Path(r'$OutputPath')
openapi_schema = app.openapi()
output_path.write_text(
    json.dumps(openapi_schema, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
    encoding='utf-8',
)
print(f'\u5df2\u751f\u6210 OpenAPI \u5951\u7ea6\uff1a{output_path}')
"@
    $pythonCode | & $Python.Command @($Python.Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "OpenAPI 契约生成失败，Python 进程退出码：$LASTEXITCODE。"
    }
}
finally {
    Pop-Location
}
