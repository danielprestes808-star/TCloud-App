[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
function Pass([string]$m){Write-Host ("[OK] "+$m) -ForegroundColor Green}
function Warn([string]$m){Write-Host ("[AVISO] "+$m) -ForegroundColor Yellow}
function Fail([string]$m){Write-Host ("[FALHA] "+$m) -ForegroundColor Red; $script:failed=$true}
$script:failed=$false

Write-Host 'TCloud - Verificação pós-instalação' -ForegroundColor Cyan
if ($env:OS -ne 'Windows_NT') { throw 'Este teste só funciona no Windows.' }

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$install = $null
foreach ($root in $uninstallRoots) {
  if (-not (Test-Path $root)) { continue }
  $install = Get-ChildItem $root -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
    Where-Object { $_.DisplayName -eq 'TCloud' } |
    Sort-Object DisplayVersion -Descending |
    Select-Object -First 1
  if ($install) { break }
}
if ($install) {
  Pass ("Instalação registrada no Windows: versão " + $install.DisplayVersion)
  if ($install.InstallLocation -and (Test-Path $install.InstallLocation)) { Pass ("Pasta instalada existe: " + $install.InstallLocation) }
  elseif ($install.InstallLocation) { Fail ("Pasta registrada não existe: " + $install.InstallLocation) }
} else {
  Warn 'Registro de desinstalação TCloud não foi localizado. Se você está rodando pelo tauri:shell, isso é esperado.'
}

$processes = @(Get-CimInstance Win32_Process -Filter "Name='tcloud.exe'" -ErrorAction SilentlyContinue)
if ($processes.Count -eq 0) { Warn 'tcloud.exe não está em execução neste momento.' }
else {
  Pass (([string]$processes.Count) + ' processo(s) tcloud.exe encontrado(s).')
  foreach ($p in $processes) { if ($p.ExecutablePath) { Write-Host ('       ' + $p.ExecutablePath) -ForegroundColor DarkGray } }
}

$startup = $null
try { $startup=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name TCloud -ErrorAction Stop).TCloud } catch {}
if ($startup) {
  Pass 'Inicialização com Windows está configurada.'
  Write-Host ('       ' + $startup) -ForegroundColor DarkGray
} else { Warn 'Inicialização com Windows está desativada (isso pode ser uma escolha do usuário).' }

$vc = $null
foreach ($view in @(
 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
)) { if (Test-Path $view) { $vc=Get-ItemProperty $view -ErrorAction SilentlyContinue; if ($vc -and $vc.Installed -eq 1) { break } } }
if ($vc -and $vc.Installed -eq 1) { Pass 'Microsoft Visual C++ Runtime x64 instalado.' } else { Fail 'Microsoft Visual C++ Runtime x64 não foi confirmado.' }

$webViewGuid='{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wv=$null
foreach($key in @(
 "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webViewGuid",
 "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webViewGuid",
 "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webViewGuid"
)) { if(Test-Path $key){$wv=Get-ItemProperty $key -ErrorAction SilentlyContinue;if($wv){break}} }
if($wv -and $wv.pv){Pass ("WebView2 Runtime disponível: "+$wv.pv)} else {Fail 'WebView2 Runtime não foi confirmado.'}

$root=Join-Path $env:USERPROFILE 'TCloud'
if(Test-Path $root -PathType Container){Pass ("Raiz TCloud disponível: "+$root)} else {Warn 'A pasta TCloud ainda não foi criada; isso é normal antes de ativar a integração com Explorer.'}

if($script:failed){Write-Host 'Verificação pós-instalação terminou com falhas.' -ForegroundColor Red; exit 2}
Write-Host 'Verificação pós-instalação concluída.' -ForegroundColor Green
exit 0
