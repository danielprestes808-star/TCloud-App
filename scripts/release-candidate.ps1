[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [int]$SoakMinutes = 0,
  [string]$ProjectRoot = ""
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw "Nao foi possivel localizar o proprio script para resolver ProjectRoot." }
  $scriptDir = Split-Path -Parent $scriptPath
  $ProjectRoot = Split-Path -Parent $scriptDir
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$resultsDir = Join-Path $ProjectRoot "stability-results"
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$steps = @()
$failed = $false
function Run-Step([string]$Name, [scriptblock]$Action) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  Write-Host ("[RC] " + $Name) -ForegroundColor Cyan
  try {
    & $Action
    if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { throw "Exit code $LASTEXITCODE" }
    $watch.Stop(); $script:steps += [pscustomobject]@{name=$Name;status="ok";seconds=[math]::Round($watch.Elapsed.TotalSeconds,2);detail=""}
    Write-Host "[OK]" -ForegroundColor Green
  } catch {
    $watch.Stop(); $script:failed = $true; $script:steps += [pscustomobject]@{name=$Name;status="failed";seconds=[math]::Round($watch.Elapsed.TotalSeconds,2);detail=$_.Exception.Message}
    Write-Host ("[FALHA] " + $_.Exception.Message) -ForegroundColor Red
  }
}
Write-Host ("TCloud {0} - Release Candidate Gate" -f $version) -ForegroundColor White
Run-Step "Desktop-only verification" { & npm.cmd run desktop:verify }
if (-not $SkipBuild) {
  Run-Step "TypeScript + Vite" { & npm.cmd run build }
  Run-Step "Rust cargo check" { & cargo check --manifest-path (Join-Path $ProjectRoot "src-tauri\Cargo.toml") }
}
Run-Step "Windows stability smoke" { & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "scripts\stability-smoke.ps1") -ProjectRoot $ProjectRoot }
if ($SoakMinutes -gt 0) {
  Run-Step ("Soak monitor ({0} min)" -f $SoakMinutes) { & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "scripts\stability-soak.ps1") -ProjectRoot $ProjectRoot -Minutes $SoakMinutes }
}
$report = [pscustomobject]@{
  version = $version
  generated_at = (Get-Date).ToString("o")
  machine = $env:COMPUTERNAME
  passed = (-not $failed)
  skip_build = [bool]$SkipBuild
  soak_minutes = $SoakMinutes
  steps = $steps
}
$reportPath = Join-Path $resultsDir ("release-candidate-{0}.json" -f $stamp)
$report | ConvertTo-Json -Depth 6 | Set-Content $reportPath -Encoding UTF8
Write-Host ""
Write-Host ("Relatorio RC: " + $reportPath) -ForegroundColor Cyan
if ($failed) { Write-Host "RC BLOQUEADA: corrija as falhas acima antes de distribuir." -ForegroundColor Red; exit 1 }
Write-Host "RC APROVADA nos testes automatizados desta maquina." -ForegroundColor Green
Write-Host "Ainda execute os cenarios manuais: queda de internet, encerramento forcado, reinicio, Cofre e arquivos grandes." -ForegroundColor Yellow
exit 0
