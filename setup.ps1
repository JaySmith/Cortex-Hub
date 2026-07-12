param(
  [string]$ConfigDir = "$env:USERPROFILE\.config\opencode"
)

Write-Host "=== Cortex Setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Copy opencode config
$src = Join-Path $PSScriptRoot "config"
if (-not (Test-Path $src)) {
  Write-Host "ERROR: config directory not found at $src" -ForegroundColor Red
  Write-Host "Run this script from the cortex/ folder on the USB drive." -ForegroundColor Yellow
  exit 1
}

Write-Host "Step 1: Installing OpenCode config..." -ForegroundColor Yellow
if (-not (Test-Path $ConfigDir)) {
  New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
  Write-Host "  Created $ConfigDir"
}
Copy-Item -Recurse -Path "$src\*" -Destination $ConfigDir -Force
Write-Host "  Copied AGENTS.md, opencode.jsonc to $ConfigDir"
Write-Host ""

# 2. Summary
Write-Host "Step 2: Project location" -ForegroundColor Yellow
$proj = Join-Path $PSScriptRoot "project"
Write-Host "  Project files are at: $proj" -ForegroundColor Green
Write-Host "  Deploy the Hub from: $proj\hub\mcp-server"
Write-Host "  Agent AGENTS.md at:  $proj\agents\<role>\AGENTS.md"
Write-Host ""

Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Copy project to target machine or work from USB"
Write-Host "  2. Deploy Hub: cd hub\mcp-server; npm install; npm run build"
Write-Host "  3. Start opencode"
