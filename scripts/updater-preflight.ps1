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
function Pass($m){Write-Host ('[OK] '+$m) -ForegroundColor Green}
function Fail($m){throw $m}

$cargo = Get-Content (Join-Path $ProjectRoot 'src-tauri\Cargo.toml') -Raw
if ($cargo -notmatch 'tauri-plugin-updater') { Fail 'Cargo.toml nao registra tauri-plugin-updater.' }
$lib = Get-Content (Join-Path $ProjectRoot 'src-tauri\src\lib.rs') -Raw
if ($lib -notmatch 'tauri_plugin_updater::Builder') { Fail 'Backend nao inicializa o plugin updater.' }
$cap = Get-Content (Join-Path $ProjectRoot 'src-tauri\capabilities\default.json') -Raw | ConvertFrom-Json
if (@($cap.permissions) -notcontains 'updater:default') { Fail 'Capability updater:default ausente.' }
Pass 'Plugin updater e permissoes registrados.'

$cliPackage = Join-Path $ProjectRoot 'node_modules\@tauri-apps\cli\package.json'
if (-not (Test-Path $cliPackage -PathType Leaf)) { Fail "Node modules ausente. Rode npm ci e depois npm run updater:toolchain." }
$cliVersion = [version]((Get-Content $cliPackage -Raw | ConvertFrom-Json).version)
if ($cliVersion -lt [version]'2.11.2') { Fail "Tauri CLI $cliVersion e antigo para fechar o updater. Rode: npm run updater:toolchain" }
Pass ('Tauri CLI alinhado: '+$cliVersion)

$private = ([string]$env:TAURI_SIGNING_PRIVATE_KEY).Trim()
$privateIsContent = $false
if (-not [string]::IsNullOrWhiteSpace($private)) {
  $privateIsContent = $private.Length -gt 120 -or $private -match 'untrusted comment:'
}
if ([string]::IsNullOrWhiteSpace($private)) {
  $private = ([string]$env:TCLOUD_UPDATER_PRIVATE_KEY_PATH).Trim()
  if ([string]::IsNullOrWhiteSpace($private)) { $private = Join-Path $env:USERPROFILE '.tcloud\updater\tcloud-updater.key' }
}
if (-not $privateIsContent) {
  if (-not (Test-Path -LiteralPath $private -PathType Leaf)) { Fail "Chave privada do updater ausente. Rode: npm run updater:keygen" }
  $resolvedPrivate = [IO.Path]::GetFullPath($private)
  if ($resolvedPrivate.StartsWith($ProjectRoot,[StringComparison]::OrdinalIgnoreCase)) { Fail 'A chave privada do updater nao pode ficar dentro da pasta do projeto.' }
}
Pass 'Chave privada do updater disponivel (conteudo nao exibido).'

$temp = Join-Path $ProjectRoot 'src-tauri\.tauri.windows.updater.preflight.conf.json'
$prepareScript = Join-Path $ProjectRoot 'scripts\prepare-updater-config.ps1'
try {
  try {
    $null = & $prepareScript -ProjectRoot $ProjectRoot -OutputPath $temp
  } catch {
    Write-Host ('[ERRO] Updater nao pode ser preparado: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'A chave ja esta pronta; falta um endpoint HTTPS real para publicar latest.json e o instalador.' -ForegroundColor Yellow
    Write-Host 'Use um remote.origin do GitHub ou defina TCLOUD_UPDATER_ENDPOINT antes da release.' -ForegroundColor Yellow
    throw
  }
  if (-not (Test-Path -LiteralPath $temp -PathType Leaf)) { Fail 'A configuracao temporaria do updater nao foi criada.' }
  $cfg = Get-Content $temp -Raw | ConvertFrom-Json
  if ($cfg.bundle.createUpdaterArtifacts -ne $true) { Fail 'createUpdaterArtifacts nao foi habilitado.' }
  $endpoint = [string](@($cfg.plugins.updater.endpoints)[0])
  if ($endpoint -notmatch '^https://') { Fail 'Endpoint final do updater nao usa HTTPS.' }
  Pass ('Endpoint HTTPS pronto: '+$endpoint)
  Pass 'Artefatos de updater e assinatura habilitados.'
} finally { Remove-Item $temp -Force -ErrorAction SilentlyContinue }
Write-Host 'Updater preflight aprovado.' -ForegroundColor Green
