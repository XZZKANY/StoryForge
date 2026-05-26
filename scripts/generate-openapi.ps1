$ErrorActionPreference = "Stop"
node (Join-Path $PSScriptRoot "generate-openapi.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
