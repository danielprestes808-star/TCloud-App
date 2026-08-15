[CmdletBinding()]
param([string]$ProjectRoot = "")
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'Nao foi possivel localizar o proprio script.' }
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
Set-Location $ProjectRoot
$targetCli = [version]'2.11.2'
$cliPackage = Join-Path $ProjectRoot 'node_modules\@tauri-apps\cli\package.json'
$current = $null
if (Test-Path -LiteralPath $cliPackage -PathType Leaf) {
  try { $current = [version]((Get-Content -LiteralPath $cliPackage -Raw | ConvertFrom-Json).version) } catch {}
}
if ($null -eq $current -or $current -lt $targetCli) {
  Write-Host ("Atualizando @tauri-apps/cli para 2.11.2 (atual: " + $(if($current){$current}else{'ausente'}) + ')...') -ForegroundColor Cyan
  & npm install --no-save --package-lock=false '@tauri-apps/cli@2.11.2'
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host ('[OK] Tauri CLI ' + $current + ' pronto para updater.') -ForegroundColor Green
}

Write-Host 'Atualizando tauri-utils dentro das restricoes do Cargo.lock...' -ForegroundColor Cyan
Push-Location (Join-Path $ProjectRoot 'src-tauri')
try {
  & cargo update -p tauri-utils
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
Write-Host '[OK] Toolchain do updater alinhada.' -ForegroundColor Green
