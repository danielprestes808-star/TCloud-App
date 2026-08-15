[CmdletBinding()]
param(
  [int]$Minutes = 30,
  [int]$IntervalSeconds = 30,
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
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
if ($Minutes -lt 1) { throw "Minutes must be at least 1." }
if ($IntervalSeconds -lt 5) { throw "IntervalSeconds must be at least 5." }

$resultsDir = Join-Path $ProjectRoot "stability-results"
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$csv = Join-Path $resultsDir ("soak-" + $stamp + ".csv")

function Resolve-TCloudProcess {
  $stage = Join-Path $ProjectRoot "dist-shell"
  $stageFull = [System.IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
  $all = @(Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue)
  $stageMatches = @($all | Where-Object {
    if (-not $_.ExecutablePath) { return $false }
    try { [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($stageFull, [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }
  })
  if ($stageMatches.Count -gt 0) { return $stageMatches }
  return $all
}

function Find-TCloudDb {
  foreach ($base in @((Join-Path $env:APPDATA "com.tcloud.desktop"), (Join-Path $env:LOCALAPPDATA "com.tcloud.desktop"))) {
    $candidate = Join-Path $base "shares.db"
    if (Test-Path $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

Write-Host "TCloud - Long Session / Soak Monitor" -ForegroundColor Cyan
Write-Host ("Duracao: {0} min | Amostra: {1} s" -f $Minutes, $IntervalSeconds)
Write-Host "Durante o teste, use o Explorer normalmente. Voce tambem pode suspender o Windows e trocar de Wi-Fi." -ForegroundColor DarkGray

$db = Find-TCloudDb
$deadline = (Get-Date).AddMinutes($Minutes)
$firstWorkingSet = $null
$firstHandles = $null
$maxWorkingSet = 0L
$maxHandles = 0
$multiInstanceSeen = $false
$samples = 0

while ((Get-Date) -lt $deadline) {
  $processes = @(Resolve-TCloudProcess)
  if ($processes.Count -eq 0) {
    Write-Host "[AVISO] tcloud.exe nao esta em execucao." -ForegroundColor Yellow
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }
  if ($processes.Count -gt 1) { $multiInstanceSeen = $true }

  $rowTime = Get-Date
  foreach ($item in $processes) {
    $proc = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    $workingSet = [int64]$proc.WorkingSet64
    $private = [int64]$proc.PrivateMemorySize64
    $handles = [int]$proc.HandleCount
    $threads = [int]$proc.Threads.Count
    if ($null -eq $firstWorkingSet) { $firstWorkingSet = $workingSet; $firstHandles = $handles }
    $maxWorkingSet = [Math]::Max($maxWorkingSet, $workingSet)
    $maxHandles = [Math]::Max($maxHandles, $handles)

    $walBytes = 0L
    if ($db) {
      $wal = $db + "-wal"
      if (Test-Path $wal -PathType Leaf) { $walBytes = [int64](Get-Item $wal).Length }
    }

    [pscustomobject]@{
      timestamp = $rowTime.ToString("o")
      pid = $proc.Id
      working_set_mb = [math]::Round($workingSet / 1MB, 2)
      private_mb = [math]::Round($private / 1MB, 2)
      handles = $handles
      threads = $threads
      cpu_seconds = [math]::Round($proc.CPU, 2)
      wal_mb = [math]::Round($walBytes / 1MB, 2)
      process_count = $processes.Count
    } | Export-Csv -Path $csv -NoTypeInformation -Append -Encoding UTF8
    $samples++
  }

  Write-Host ("[{0}] RAM {1:N1} MB | Handles {2} | Instancias {3}" -f $rowTime.ToString("HH:mm:ss"), ($workingSet / 1MB), $handles, $processes.Count)
  Start-Sleep -Seconds $IntervalSeconds
}

Write-Host ""
Write-Host ("Amostras: {0}" -f $samples) -ForegroundColor Cyan
Write-Host ("Pico de RAM: {0:N1} MB" -f ($maxWorkingSet / 1MB))
Write-Host ("Pico de handles: {0}" -f $maxHandles)
if ($firstWorkingSet) {
  $growth = $maxWorkingSet - $firstWorkingSet
  if ($growth -gt 256MB) { Write-Host ("[AVISO] RAM cresceu mais de 256 MB durante o teste: +{0:N1} MB" -f ($growth / 1MB)) -ForegroundColor Yellow }
  else { Write-Host ("[OK] Crescimento de RAM dentro do limite de observacao: +{0:N1} MB" -f ($growth / 1MB)) -ForegroundColor Green }
}
if ($firstHandles -ne $null) {
  $handleGrowth = $maxHandles - $firstHandles
  if ($handleGrowth -gt 500) { Write-Host ("[AVISO] Handles cresceram bastante: +{0}" -f $handleGrowth) -ForegroundColor Yellow }
  else { Write-Host ("[OK] Handles estaveis: +{0}" -f $handleGrowth) -ForegroundColor Green }
}
if ($multiInstanceSeen) { Write-Host "[FALHA] Mais de uma instancia do TCloud foi observada." -ForegroundColor Red }
else { Write-Host "[OK] Nenhuma duplicacao de instancia observada." -ForegroundColor Green }
Write-Host ("Relatorio CSV: " + $csv) -ForegroundColor Cyan
