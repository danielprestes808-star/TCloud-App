$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
if (-not (Get-Command winapp -ErrorAction SilentlyContinue)) {
  Write-Host "Instale a winapp CLI: winget install Microsoft.winappcli --source winget" -ForegroundColor Yellow
  exit 2
}
# Gere o executavel pelo Tauri CLI para incorporar build.frontendDist no binario.
& node (Join-Path $ProjectRoot "scripts\tauri-cli.cjs") build --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$Stage = Join-Path $ProjectRoot "dist-msix"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage | Out-Null
Copy-Item (Join-Path $ProjectRoot "src-tauri\target\release\tcloud.exe") (Join-Path $Stage "tcloud.exe") -Force
Write-Host "Gerando pacote MSIX de desenvolvimento assinado..." -ForegroundColor Cyan
& winapp pack $Stage --manifest (Join-Path $ProjectRoot "Package.appxmanifest") --generate-cert --install-cert
exit $LASTEXITCODE
