[CmdletBinding()]
param(
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptDir = $null
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $scriptDir = $PSScriptRoot
  } elseif (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
    $scriptDir = Split-Path -Parent $PSCommandPath
  } elseif ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  if ([string]::IsNullOrWhiteSpace($scriptDir)) {
    throw "Nao foi possivel localizar a pasta do script stability-smoke.ps1."
  }
  $ProjectRoot = Split-Path -Parent $scriptDir
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)

$failures = 0
$warnings = 0

function Pass([string]$Text) { Write-Host ("[OK] " + $Text) -ForegroundColor Green }
function Warn([string]$Text) { $script:warnings++; Write-Host ("[AVISO] " + $Text) -ForegroundColor Yellow }
function Fail([string]$Text) { $script:failures++; Write-Host ("[FALHA] " + $Text) -ForegroundColor Red }

Write-Host "TCloud - Stability Smoke Check" -ForegroundColor Cyan

$package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$tauri = Get-Content (Join-Path $ProjectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$manifestText = Get-Content (Join-Path $ProjectRoot "Package.appxmanifest") -Raw
if ($package.version -eq $tauri.version -and $manifestText -match ('Version="' + [regex]::Escape($package.version) + '\.0"')) {
  Pass ("Versoes consistentes: " + $package.version)
} else {
  Fail "package.json, tauri.conf.json e Package.appxmanifest nao usam a mesma versao."
}

$stage = Join-Path $ProjectRoot "dist-shell"
$stageFull = [System.IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
$stageProcesses = @(Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue | Where-Object {
  if (-not $_.ExecutablePath) { return $false }
  try { [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($stageFull, [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }
})
if ($stageProcesses.Count -eq 1) { Pass ("Instancia unica do staging em execucao (PID " + $stageProcesses[0].ProcessId + ").") }
elseif ($stageProcesses.Count -eq 0) { Warn "Nenhuma instancia do staging esta em execucao agora." }
else { Fail ("Ha " + $stageProcesses.Count + " instancias do staging.") }

$pkg = Get-AppxPackage -Name "TCloudDesktop" -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
if ($pkg) { Pass ("Package Identity presente: " + $pkg.PackageFullName) } else { Warn "TCloudDesktop nao apareceu em Get-AppxPackage; o modo CFAPI direto ainda pode funcionar." }

$startup = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "TCloud" -ErrorAction SilentlyContinue
if ($startup -and $startup.TCloud) { Pass "Inicializacao com o Windows registrada." } else { Warn "Inicializacao com o Windows nao esta registrada para este usuario." }

$root = Join-Path $env:USERPROFILE "TCloud"
if (Test-Path $root -PathType Container) { Pass ("Pasta TCloud encontrada: " + $root) } else { Warn ("Pasta TCloud ainda nao existe em " + $root) }

$appDataCandidates = @(
  (Join-Path $env:APPDATA "com.tcloud.desktop"),
  (Join-Path $env:LOCALAPPDATA "com.tcloud.desktop")
)
$db = $null
foreach ($candidate in $appDataCandidates) {
  $candidateDb = Join-Path $candidate "shares.db"
  if (Test-Path $candidateDb -PathType Leaf) { $db = $candidateDb; break }
}
if ($db) {
  Pass ("Banco local encontrado: " + $db)
  $appData = Split-Path -Parent $db
  $recoveryDir = Join-Path $env:LOCALAPPDATA "TCloudRecovery"
  $installIdFile = Join-Path $appData "stability-install-id.txt"
  $recoveryIdFile = Join-Path $recoveryDir "stability-install-id.txt"
  if ((Test-Path $installIdFile -PathType Leaf) -or (Test-Path $recoveryIdFile -PathType Leaf)) { Pass "Identidade persistente de instalacao presente." } else { Warn "Identidade persistente ainda nao foi criada; abra a Fase 3 uma vez." }
  $backupDir = Join-Path $recoveryDir "stability-backups"
  if (Test-Path $backupDir -PathType Container) {
    $backups = @(Get-ChildItem $backupDir -Filter "shares-pre-*.db" -File -ErrorAction SilentlyContinue)
    if ($backups.Count -gt 0) { Pass ("Backup pre-migracao presente: " + $backups.Count) } else { Warn "Pasta de backups sem snapshot." }
  } else { Warn "Backup pre-migracao ainda nao existe (normal em instalacao nova)." }
  $wal = $db + "-wal"
  if (Test-Path $wal) {
    $walSize = (Get-Item $wal).Length
    if ($walSize -gt 512MB) { Warn ("WAL esta grande: " + [math]::Round($walSize / 1MB, 1) + " MB") }
    else { Pass ("WAL em tamanho normal: " + [math]::Round($walSize / 1MB, 1) + " MB") }
  }
} else {
  Warn "Banco local nao foi localizado nos caminhos padrao; abra o TCloud ao menos uma vez."
}

$startupLog = Join-Path $ProjectRoot "stability-results\startup-latest.log"
if (Test-Path $startupLog -PathType Leaf) {
  $lastStartup = Get-Content $startupLog -Tail 1 -ErrorAction SilentlyContinue
  if ($lastStartup) { Pass ("Log de startup disponivel: " + $startupLog) }
}

Write-Host ""
Write-Host ("Resultado: " + $failures + " falha(s), " + $warnings + " aviso(s).") -ForegroundColor Cyan
if ($failures -gt 0) { exit 1 }
exit 0
