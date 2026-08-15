[CmdletBinding()]
param(
  [int]$FileCount = 5000,
  [int]$Folders = 50,
  [int]$FileSizeKB = 1,
  [switch]$PopulateTCloud,
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
if ($FileCount -lt 1 -or $Folders -lt 1 -or $FileSizeKB -lt 0) { throw "Parametros de stress invalidos." }
$resultsDir = Join-Path $ProjectRoot "stability-results"
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$source = Join-Path $resultsDir ("stress-source-" + $stamp)
New-Item -ItemType Directory -Path $source -Force | Out-Null
function Snapshot-Process {
  $rows = @()
  foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue)) {
    $proc = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if ($proc) { $rows += [pscustomobject]@{ pid=$proc.Id; working_set_mb=[math]::Round($proc.WorkingSet64/1MB,2); private_mb=[math]::Round($proc.PrivateMemorySize64/1MB,2); handles=$proc.HandleCount; threads=$proc.Threads.Count; cpu_seconds=[math]::Round($proc.CPU,2); executable=$item.ExecutablePath } }
  }
  $rows
}
Write-Host "TCloud - Stress de milhares de arquivos" -ForegroundColor Cyan
Write-Host ("Arquivos: {0} | Pastas: {1} | {2} KB por arquivo" -f $FileCount,$Folders,$FileSizeKB)
Write-Host "Por padrao o conjunto fica fora do TCloud. Use -PopulateTCloud para gerar sincronizacao real." -ForegroundColor DarkGray
$before = @(Snapshot-Process)
$payload = if ($FileSizeKB -gt 0) { "x" * ($FileSizeKB * 1024) } else { "" }
$createWatch=[Diagnostics.Stopwatch]::StartNew()
for ($i=0; $i -lt $FileCount; $i++) {
  $dir=Join-Path (Join-Path $source ("grupo-{0:D3}" -f ($i % $Folders))) ("lote-{0:D3}" -f [math]::Floor($i/[math]::Max(1,$Folders*100)))
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [IO.File]::WriteAllText((Join-Path $dir ("arquivo-{0:D6}.txt" -f $i)),("TCloud stress {0}`r`n{1}" -f $i,$payload),[Text.UTF8Encoding]::new($false))
  if (($i+1)%1000 -eq 0) { Write-Host ("  Criados {0}/{1}" -f ($i+1),$FileCount) }
}
$createWatch.Stop()
$enumWatch=[Diagnostics.Stopwatch]::StartNew(); $files=@(Get-ChildItem $source -File -Recurse); $enumWatch.Stop()
if ($files.Count -ne $FileCount) { throw "Esperado $FileCount arquivos; encontrados $($files.Count)." }
$destination=$null; $copySeconds=$null
if ($PopulateTCloud) {
  $root=Join-Path $env:USERPROFILE "TCloud"
  if (-not (Test-Path $root -PathType Container)) { throw "Conecte o TCloud primeiro: $root nao existe." }
  $destination=Join-Path $root ("Stability Stress " + $stamp)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Write-Host "Copiando para o TCloud; isto cria sincronizacao real." -ForegroundColor Yellow
  $w=[Diagnostics.Stopwatch]::StartNew(); $null=& robocopy $source $destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP; $rc=$LASTEXITCODE; $w.Stop()
  if ($rc -gt 7) { throw "Robocopy falhou: $rc" }; $copySeconds=[math]::Round($w.Elapsed.TotalSeconds,2)
}
Start-Sleep -Seconds 2
$report=[pscustomobject]@{timestamp=(Get-Date).ToString("o");file_count=$FileCount;folders=$Folders;file_size_kb=$FileSizeKB;source=$source;tcloud_destination=$destination;populate_tcloud=[bool]$PopulateTCloud;create_seconds=[math]::Round($createWatch.Elapsed.TotalSeconds,2);enumerate_seconds=[math]::Round($enumWatch.Elapsed.TotalSeconds,2);copy_seconds=$copySeconds;processes_before=$before;processes_after=@(Snapshot-Process)}
$reportPath=Join-Path $resultsDir ("stress-"+$stamp+".json"); $report|ConvertTo-Json -Depth 6|Set-Content $reportPath -Encoding UTF8
Write-Host ("[OK] {0} arquivos em {1:N2}s; enumeracao {2:N2}s." -f $FileCount,$createWatch.Elapsed.TotalSeconds,$enumWatch.Elapsed.TotalSeconds) -ForegroundColor Green
if ($PopulateTCloud) { Write-Host ("[OK] Copia para TCloud: {0}s -> {1}" -f $copySeconds,$destination) -ForegroundColor Green }
Write-Host ("Relatorio: "+$reportPath) -ForegroundColor Cyan
