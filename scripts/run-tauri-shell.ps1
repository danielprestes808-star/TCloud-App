$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# Explicitly mark this launch as the loose development/staging package.
# The app uses this flag to avoid treating rapid rebuilds as failed updates.
$env:TCLOUD_STAGING = "1"
$StartupDir = Join-Path $ProjectRoot "stability-results"
New-Item -ItemType Directory -Path $StartupDir -Force | Out-Null
$StartupLog = Join-Path $StartupDir "startup-latest.log"
$FallbackStartupLog = Join-Path $env:LOCALAPPDATA "TCloud\logs\startup.log"
$env:TCLOUD_STARTUP_LOG = $StartupLog
Remove-Item -LiteralPath $StartupLog -Force -ErrorAction SilentlyContinue

if (-not (Get-Command winapp -ErrorAction SilentlyContinue)) {
  Write-Host "[TCloud] winapp CLI nao encontrado." -ForegroundColor Yellow
  Write-Host "Instale uma vez com: winget install Microsoft.winappcli --source winget" -ForegroundColor Cyan
  exit 2
}

Write-Host "[TCloud] 1/5 Compilando TCloud release com frontend embutido..." -ForegroundColor Cyan
& node (Join-Path $ProjectRoot "scripts\tauri-cli.cjs") build --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[TCloud] 2/5 Preparando pasta de execucao sem desmontar a identidade existente..." -ForegroundColor Cyan
$Exe = Join-Path $ProjectRoot "src-tauri\target\release\tcloud.exe"
if (-not (Test-Path $Exe)) { throw "Executavel nao encontrado: $Exe" }
$Stage = Join-Path $ProjectRoot "dist-shell"

function Stop-TCloudStageProcesses {
  param([string]$StagePath)

  $stageFull = [System.IO.Path]::GetFullPath($StagePath).TrimEnd('\') + '\'
  $processes = Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $processes) {
    if (-not $process.ExecutablePath) { continue }
    try {
      $exeFull = [System.IO.Path]::GetFullPath($process.ExecutablePath)
      if ($exeFull.StartsWith($stageFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Host ("[TCloud] Encerrando instancia anterior do staging (PID " + $process.ProcessId + ")...") -ForegroundColor DarkYellow
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
      }
    } catch { }
  }
}

# IMPORTANT: do not delete/unregister the loose package on every build. Removing
# the development package can tear down StorageProvider registrations associated
# with it, which makes Windows remove online-only placeholders from the Sync Root.
Stop-TCloudStageProcesses -StagePath $Stage
Start-Sleep -Milliseconds 450
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

$StageExe = Join-Path $Stage "tcloud.exe"
$copied = $false
for ($attempt = 1; $attempt -le 8; $attempt++) {
  try {
    Copy-Item $Exe $StageExe -Force -ErrorAction Stop
    $copied = $true
    break
  } catch {
    if ($attempt -eq 8) { throw "Nao foi possivel atualizar $StageExe. Erro: $($_.Exception.Message)" }
    Stop-TCloudStageProcesses -StagePath $Stage
    Start-Sleep -Milliseconds (250 * $attempt)
  }
}
if (-not $copied) { throw "Falha ao preparar executavel do TCloud." }

if (Test-Path (Join-Path $ProjectRoot "Assets")) {
  $StageAssets = Join-Path $Stage "Assets"
  New-Item -ItemType Directory -Path $StageAssets -Force | Out-Null
  Copy-Item (Join-Path $ProjectRoot "Assets\*") $StageAssets -Recurse -Force
}

$Manifest = Join-Path $ProjectRoot "Package.appxmanifest"
Write-Host "[TCloud] 3/5 Preservando registro e encerrando somente a instancia deste staging..." -ForegroundColor Cyan
# Nao encerre indiscriminadamente todo processo tcloud.exe do Windows. Uma instalacao
# estavel pode estar sincronizando em outro caminho. Somente o executavel de dist-shell
# pertence a este ciclo de desenvolvimento.
Stop-TCloudStageProcesses -StagePath $Stage
Start-Sleep -Milliseconds 350

Write-Host "[TCloud] 4/5 Atualizando loose-layout e iniciando com Package Identity..." -ForegroundColor Green
$runOutput = & winapp run $Stage --manifest $Manifest --detach --json
if ($LASTEXITCODE -ne 0) {
  $runOutput | Out-Host
  Write-Host "[TCloud] A atualizacao em lugar do pacote falhou." -ForegroundColor Red
  Write-Host "[TCloud] Por seguranca, o script NAO executou winapp unregister: remover o pacote pode desmontar o Cloud Sync Root e apagar placeholders online-only do Explorer." -ForegroundColor Yellow
  Write-Host "[TCloud] Envie este erro antes de desregistrar o pacote manualmente." -ForegroundColor Yellow
  exit $LASTEXITCODE
}
$runOutput | Out-Host

Write-Host "[TCloud] 5/5 Verificando pacote registrado..." -ForegroundColor Cyan
Start-Sleep -Milliseconds 500
$Pkg = Get-AppxPackage -Name "TCloudDesktop" -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
if ($null -eq $Pkg) {
  Write-Host "[TCloud] AVISO: pacote TCloudDesktop nao apareceu em Get-AppxPackage." -ForegroundColor Yellow
  Write-Host "[TCloud] O offline continua disponivel pelo registro direto do Sync Root/fallback do Explorer." -ForegroundColor Yellow
} else {
  Write-Host ("[TCloud] PackageFullName: " + $Pkg.PackageFullName) -ForegroundColor Green
  Write-Host ("[TCloud] PackageFamilyName: " + $Pkg.PackageFamilyName) -ForegroundColor Green
  Write-Host ("[TCloud] DevelopmentMode: " + $Pkg.IsDevelopmentMode) -ForegroundColor Green
}
# Stability 12.8: confirme que a instancia realmente sobreviveu ao startup.
# winapp pode retornar sucesso mesmo se o processo iniciar e encerrar logo depois.
$runInfo = $null
try {
  $runInfo = (($runOutput -join [Environment]::NewLine) | ConvertFrom-Json)
} catch { }
$reportedPid = if ($runInfo -and $runInfo.ProcessId) { [int]$runInfo.ProcessId } else { 0 }

Start-Sleep -Seconds 3
$stageFull = [System.IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\'
$stageProcesses = @(Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue | Where-Object {
  if (-not $_.ExecutablePath) { return $false }
  try { [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($stageFull, [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }
})

if ($stageProcesses.Count -gt 1) {
  Write-Host ("[TCloud] AVISO de estabilidade: " + $stageProcesses.Count + " processos do staging foram encontrados.") -ForegroundColor Yellow
} elseif ($stageProcesses.Count -eq 1) {
  Write-Host ("[TCloud] Instancia unica confirmada e ativa (PID " + $stageProcesses[0].ProcessId + ").") -ForegroundColor Green
} else {
  Write-Host "[TCloud] ERRO: o executavel iniciou, mas encerrou durante o startup." -ForegroundColor Red
  if ($reportedPid -gt 0) { Write-Host ("[TCloud] PID informado pelo winapp: " + $reportedPid) -ForegroundColor DarkYellow }
  Write-Host ("[TCloud] Log de diagnostico: " + $StartupLog) -ForegroundColor Yellow
  if (Test-Path $StartupLog -PathType Leaf) {
    Write-Host "[TCloud] Ultimas linhas do startup:" -ForegroundColor Yellow
    Get-Content $StartupLog -Tail 40 | ForEach-Object { Write-Host ("  " + $_) }
  } elseif (Test-Path $FallbackStartupLog -PathType Leaf) {
    Write-Host ("[TCloud] O Package Identity nao propagou TCLOUD_STARTUP_LOG; lendo o log local: " + $FallbackStartupLog) -ForegroundColor Yellow
    Write-Host "[TCloud] Ultimas linhas do startup local:" -ForegroundColor Yellow
    Get-Content $FallbackStartupLog -Tail 40 | ForEach-Object { Write-Host ("  " + $_) }
  } else {
    Write-Host "[TCloud] O processo encerrou antes de conseguir criar qualquer log Rust." -ForegroundColor Yellow
  }
  exit 3
}

Write-Host "[TCloud] O processo foi destacado; este terminal pode ser fechado." -ForegroundColor Green
exit 0
