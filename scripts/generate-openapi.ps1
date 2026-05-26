$ErrorActionPreference = "Stop"
# 实际生成逻辑委托给 generate-openapi.mjs：从 FastAPI app.openapi() 写入 packages/shared/src/contracts/storyforge.openapi.json。
node (Join-Path $PSScriptRoot "generate-openapi.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
