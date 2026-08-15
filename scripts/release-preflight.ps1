[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [switch]$SkipRuntimeDownload,
  [switch]$RequireSignature
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
Set-Location $ProjectRoot

function Pass([string]$Message) { Write-Host ("[OK] " + $Message) -ForegroundColor Green }
function Info([string]$Message) { Write-Host ("[INFO] " + $Message) -ForegroundColor Cyan }
function Fail([string]$Message) { throw $Message }
function Need-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Fail ("Comando obrigatório não encontrado: " + $Name) }
  Pass ("Comando disponível: " + $Name)
}
function Read-TomlPackageVersion([string]$Path) {
  $raw = Get-Content -LiteralPath $Path -Raw
  $match = [regex]::Match($raw, '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')
  if (-not $match.Success) { Fail "Não foi possível ler [package].version do Cargo.toml." }
  return $match.Groups[1].Value
}
function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
    $parts = $trimmed -split '=', 2
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

Write-Host "TCloud - Windows Distribution Preflight" -ForegroundColor Cyan
Write-Host "Projeto: $ProjectRoot" -ForegroundColor DarkGray

if ($env:OS -ne 'Windows_NT') { Fail "A distribuição Windows deve ser preparada no Windows." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "O build atual do TCloud requer Windows x64." }
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 19041) { Fail ("Windows 10 build 19041 ou superior é necessário. Build detectado: " + $build) }
Pass ("Windows compatível (build " + $build + ", x64).")

Need-Command node
Need-Command npm
Need-Command cargo
Need-Command rustc

$packagePath = Join-Path $ProjectRoot 'package.json'
$tauriPath = Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'
$releaseConfigPath = Join-Path $ProjectRoot 'src-tauri\tauri.windows.release.conf.json'
$cargoPath = Join-Path $ProjectRoot 'src-tauri\Cargo.toml'
$manifestPath = Join-Path $ProjectRoot 'Package.appxmanifest'
foreach ($required in @($packagePath,$tauriPath,$releaseConfigPath,$cargoPath,$manifestPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { Fail ("Arquivo obrigatório ausente: " + $required) }
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$tauri = Get-Content -LiteralPath $tauriPath -Raw | ConvertFrom-Json
$releaseConfig = Get-Content -LiteralPath $releaseConfigPath -Raw | ConvertFrom-Json
$cargoVersion = Read-TomlPackageVersion $cargoPath
$manifestRaw = Get-Content -LiteralPath $manifestPath -Raw
$manifestMatch = [regex]::Match($manifestRaw, '<Identity[^>]+Version="([^"]+)"')
if (-not $manifestMatch.Success) { Fail "Package.appxmanifest não contém Identity Version." }
$manifestVersion = $manifestMatch.Groups[1].Value
$expectedManifestVersion = ([string]$package.version) + '.0'

$versions = @([string]$package.version, [string]$tauri.version, [string]$cargoVersion)
if (($versions | Select-Object -Unique).Count -ne 1) {
  Fail ("Versões divergentes: package=" + $package.version + ", tauri=" + $tauri.version + ", cargo=" + $cargoVersion)
}
if ($manifestVersion -ne $expectedManifestVersion) {
  Fail ("Manifesto divergente: " + $manifestVersion + " (esperado " + $expectedManifestVersion + ")")
}
Pass ("Versão sincronizada em package/Tauri/Cargo/MSIX: " + $package.version)

if ($tauri.identifier -ne 'com.tcloud.desktop') { Fail ("Identifier inesperado: " + $tauri.identifier) }
if ($tauri.productName -ne 'TCloud') { Fail ("productName inesperado: " + $tauri.productName) }
Pass "Identidade de produto consistente."

$releaseWindow = @($releaseConfig.app.windows)[0]
if ($null -eq $releaseWindow -or $releaseWindow.devtools -ne $false) { Fail "O build de distribuição deve desativar DevTools." }
if ($releaseConfig.bundle.windows.nsis.installMode -ne 'currentUser') { Fail "O instalador estável deve usar installMode=currentUser nesta fase." }
$languages = @($releaseConfig.bundle.windows.nsis.languages)
if ($languages -notcontains 'PortugueseBR') { Fail "O instalador precisa incluir Português do Brasil." }
Pass "Configuração de release: DevTools desligado, instalação por usuário e pt-BR habilitado."

$cliPackage = Join-Path $ProjectRoot 'node_modules\@tauri-apps\cli\package.json'
if (-not (Test-Path -LiteralPath $cliPackage -PathType Leaf)) {
  Fail "Dependências Node não estão instaladas. Rode 'npm ci' uma vez antes de preparar a distribuição."
}
Pass "Tauri CLI local disponível."

$icons = @(
  'src-tauri\icons\32x32.png',
  'src-tauri\icons\128x128.png',
  'src-tauri\icons\128x128@2x.png',
  'src-tauri\icons\icon.ico',
  'Assets\Square150x150Logo.png',
  'Assets\Square44x44Logo.png',
  'Assets\StoreLogo.png'
)
foreach ($relative in $icons) {
  $icon = Join-Path $ProjectRoot $relative
  if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { Fail ("Ícone/asset obrigatório ausente: " + $relative) }
  if ((Get-Item -LiteralPath $icon).Length -le 0) { Fail ("Ícone/asset vazio: " + $relative) }
}
Pass "Ícones do aplicativo/instalador presentes."

$apiId = [Environment]::GetEnvironmentVariable('TCLOUD_TELEGRAM_API_ID')
$apiHash = [Environment]::GetEnvironmentVariable('TCLOUD_TELEGRAM_API_HASH')
$envFile = Join-Path $ProjectRoot 'src-tauri\.env.tcloud'
if ([string]::IsNullOrWhiteSpace($apiId)) { $apiId = Read-EnvValue $envFile 'TCLOUD_TELEGRAM_API_ID' }
if ([string]::IsNullOrWhiteSpace($apiHash)) { $apiHash = Read-EnvValue $envFile 'TCLOUD_TELEGRAM_API_HASH' }
if ([string]::IsNullOrWhiteSpace($apiId) -or $apiId -notmatch '^\d+$' -or $apiId -eq '12345678') {
  Fail "TCLOUD_TELEGRAM_API_ID real não está configurado para o build."
}
if ([string]::IsNullOrWhiteSpace($apiHash) -or $apiHash.Length -lt 20 -or $apiHash -match 'coloque_o_api_hash|SEU_API_HASH') {
  Fail "TCLOUD_TELEGRAM_API_HASH real não está configurado para o build."
}
Pass "Credenciais de aplicativo Telegram configuradas (valores não exibidos)."

if ($RequireSignature) {
  $thumbprint = ([string][Environment]::GetEnvironmentVariable('TCLOUD_WINDOWS_CERT_THUMBPRINT')).Replace(' ', '').Trim()
  $timestampUrl = ([string][Environment]::GetEnvironmentVariable('TCLOUD_WINDOWS_TIMESTAMP_URL')).Trim()
  $digest = ([string][Environment]::GetEnvironmentVariable('TCLOUD_WINDOWS_DIGEST_ALGORITHM')).Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($digest)) { $digest = 'sha256' }
  if ($thumbprint -notmatch '^[A-Fa-f0-9]{40,64}$') {
    Fail "Release pública exige TCLOUD_WINDOWS_CERT_THUMBPRINT com o thumbprint do certificado de assinatura instalado."
  }
  if ([string]::IsNullOrWhiteSpace($timestampUrl) -or $timestampUrl -notmatch '^https?://') {
    Fail "Release pública exige TCLOUD_WINDOWS_TIMESTAMP_URL válido."
  }
  if ($digest -notin @('sha256','sha384','sha512')) { Fail "TCLOUD_WINDOWS_DIGEST_ALGORITHM inválido." }
  $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
    Where-Object { ($_.Thumbprint -replace ' ','') -ieq $thumbprint } |
    Select-Object -First 1
  if (-not $cert) { Fail "Certificado de assinatura não foi encontrado em CurrentUser/My ou LocalMachine/My." }
  if (-not $cert.HasPrivateKey) { Fail "O certificado encontrado não possui chave privada disponível para assinatura." }
  if ($cert.NotAfter -le (Get-Date)) { Fail "O certificado de assinatura está expirado." }
  Pass ("Certificado de assinatura pronto: " + $cert.Subject + " (thumbprint validado; chave privada disponível).")
}

$runtimePath = Join-Path $ProjectRoot 'src-tauri\resources\vc_redist.x64.exe'
if (-not $SkipRuntimeDownload) {
  Info "Validando Microsoft Visual C++ Runtime usado pelo instalador..."
  & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'scripts\prepare-windows-runtime.ps1') -OutputPath $runtimePath
  if ($LASTEXITCODE -ne 0) { Fail "Falha ao preparar o Microsoft Visual C++ Runtime." }
}
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
  Fail "Microsoft Visual C++ Runtime não está preparado. Rode scripts\prepare-windows-runtime.ps1."
}
$runtimeSig = Get-AuthenticodeSignature -FilePath $runtimePath
if ($runtimeSig.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $runtimeSig.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  Fail "O vc_redist.x64.exe preparado não possui assinatura Microsoft válida."
}
Pass "Microsoft Visual C++ Runtime verificado."

$envExample = Join-Path $ProjectRoot 'src-tauri\.env.tcloud.example'
if (-not (Test-Path -LiteralPath $envExample -PathType Leaf)) { Fail ".env.tcloud.example ausente." }
$gitignore = Join-Path $ProjectRoot 'src-tauri\.gitignore'
if ((Get-Content -LiteralPath $gitignore -Raw) -notmatch '(?m)^\.env\.tcloud$') {
  Write-Host "[AVISO] src-tauri/.gitignore não ignora explicitamente .env.tcloud." -ForegroundColor Yellow
} else { Pass "Arquivo local de credenciais está protegido pelo .gitignore." }

Pass ("Preflight de distribuição aprovado para TCloud " + $package.version + ".")
