[CmdletBinding()]
param([ValidateSet("Capture","Verify")][string]$Mode="Capture",[string]$BaselinePath,[string]$ProjectRoot="")
$ErrorActionPreference="Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw "Nao foi possivel localizar o proprio script para resolver ProjectRoot." }
  $scriptDir = Split-Path -Parent $scriptPath
  $ProjectRoot = Split-Path -Parent $scriptDir
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$resultsDir=Join-Path $ProjectRoot "stability-results"; New-Item -ItemType Directory -Path $resultsDir -Force|Out-Null
function Find-AppData { foreach($base in @((Join-Path $env:APPDATA "com.tcloud.desktop"),(Join-Path $env:LOCALAPPDATA "com.tcloud.desktop"))){if(Test-Path $base -PathType Container){return $base}}; return (Join-Path $env:APPDATA "com.tcloud.desktop") }
function Snapshot-State {
  $appData=Find-AppData; $db=Join-Path $appData "shares.db"; $id1=Join-Path $appData "stability-install-id.txt"; $id2=Join-Path (Join-Path $env:LOCALAPPDATA "TCloudRecovery") "stability-install-id.txt"
  $installId=if(Test-Path $id1){(Get-Content $id1 -Raw).Trim()}elseif(Test-Path $id2){(Get-Content $id2 -Raw).Trim()}else{$null}
  $root=Join-Path $env:USERPROFILE "TCloud"; $count=if(Test-Path $root){@(Get-ChildItem $root -File -Recurse -ErrorAction SilentlyContinue).Count}else{0}; $startup=$null; try{$startup=(Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name TCloud -ErrorAction Stop).TCloud}catch{}
  $pkg=Get-Content (Join-Path $ProjectRoot "package.json") -Raw|ConvertFrom-Json
  [pscustomobject]@{captured_at=(Get-Date).ToString("o");source_version=[string]$pkg.version;app_data=$appData;install_id=$installId;database_exists=(Test-Path $db);database_bytes=$(if(Test-Path $db){[int64](Get-Item $db).Length}else{0});tcloud_root=$root;root_exists=$(Test-Path $root);root_file_count=$count;startup_command=$startup}
}
if($Mode -eq "Capture"){$snap=Snapshot-State;if(-not $snap.install_id){Write-Host "[AVISO] Abra esta versao uma vez antes de capturar." -ForegroundColor Yellow};$path=Join-Path $resultsDir ("upgrade-baseline-"+(Get-Date -Format "yyyyMMdd-HHmmss")+".json");$snap|ConvertTo-Json -Depth 5|Set-Content $path -Encoding UTF8;Write-Host "Baseline criada:" -ForegroundColor Green;Write-Host $path -ForegroundColor Cyan;exit 0}
if(-not $BaselinePath){$latest=Get-ChildItem $resultsDir -Filter "upgrade-baseline-*.json" -File|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1;if(-not $latest){throw "Capture uma baseline primeiro."};$BaselinePath=$latest.FullName}
$before=Get-Content $BaselinePath -Raw|ConvertFrom-Json;$after=Snapshot-State;$fail=0;$warn=0
function Pass($t){Write-Host ("[OK] "+$t) -ForegroundColor Green};function Warn($t){$script:warn++;Write-Host ("[AVISO] "+$t) -ForegroundColor Yellow};function Fail($t){$script:fail++;Write-Host ("[FALHA] "+$t) -ForegroundColor Red}
if($before.install_id -and $after.install_id -eq $before.install_id){Pass "Identidade local preservada."}elseif(-not $before.install_id){Warn "Baseline sem ID persistente."}else{Fail "Identidade local mudou."}
if($before.database_exists -and $after.database_exists){Pass "Banco local preservado."}elseif($before.database_exists){Fail "Banco local desapareceu."}else{Warn "Baseline sem banco."}
if($before.root_exists -and $after.root_exists){Pass "Pasta TCloud preservada."}elseif($before.root_exists){Fail "Pasta TCloud desapareceu."}
if([int]$before.root_file_count -gt 0 -and [int]$after.root_file_count -lt [int]$before.root_file_count){Warn ("Arquivos visiveis cairam de {0} para {1}." -f $before.root_file_count,$after.root_file_count)}else{Pass ("Arquivos visiveis: "+$after.root_file_count)}
if($before.startup_command){if($after.startup_command){Pass "Startup preservado."}else{Warn "Startup estava ativo e nao apareceu depois."}}
$backupDir=Join-Path (Join-Path $env:LOCALAPPDATA "TCloudRecovery") "stability-backups"
if($before.database_exists){$backups=@(Get-ChildItem $backupDir -Filter "shares-pre-*.db" -File -ErrorAction SilentlyContinue);if($backups.Count -gt 0){Pass ("Backup de migracao preservado: "+$backups.Count)}else{Warn "Nenhum backup de migracao foi encontrado em TCloudRecovery."}}
Write-Host ("Resultado: {0} falha(s), {1} aviso(s)." -f $fail,$warn) -ForegroundColor Cyan;if($fail -gt 0){exit 1}
