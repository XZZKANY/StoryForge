$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ApiRoot = Join-Path $Root "apps/api"
$OutputPath = Join-Path $Root "packages/shared/src/contracts/storyforge.openapi.json"
$OutputDirectory = Split-Path -Parent $OutputPath

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

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
    $pythonCode | uv run python -
}
finally {
    Pop-Location
}