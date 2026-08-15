[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [string]$KeyPath = "",
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'Nao foi possivel localizar o proprio script.' }
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
Set-Location $ProjectRoot
if ([string]::IsNullOrWhiteSpace($KeyPath)) { $KeyPath = Join-Path $env:USERPROFILE '.tcloud\updater\tcloud-updater.key' }
$KeyPath = [IO.Path]::GetFullPath($KeyPath)
$pubPath = $KeyPath + '.pub'
New-Item -ItemType Directory -Path (Split-Path -Parent $KeyPath) -Force | Out-Null

if ((Test-Path -LiteralPath $KeyPath) -and -not $Force) {
  Write-Host '[INFO] A chave privada do updater ja existe; nada foi sobrescrito.' -ForegroundColor Yellow
} else {
  if ($Force) {
    Remove-Item -LiteralPath $KeyPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pubPath -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Gerando chave de assinatura do updater fora da pasta do projeto...' -ForegroundColor Cyan
  & node (Join-Path $ProjectRoot 'scripts\tauri-cli.cjs') signer generate -w $KeyPath
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw 'A chave privada nao foi criada.' }
if (-not (Test-Path -LiteralPath $pubPath -PathType Leaf)) { throw 'A chave publica nao foi criada.' }

Write-Host '[OK] Par de chaves do updater pronto.' -ForegroundColor Green
Write-Host ('Privada: ' + $KeyPath) -ForegroundColor Yellow
Write-Host ('Publica: ' + $pubPath) -ForegroundColor Green
Write-Host 'IMPORTANTE: nunca envie, publique ou copie a chave privada para o repositorio.' -ForegroundColor Yellow
Write-Host 'Para releases locais, o pipeline usa este caminho automaticamente.' -ForegroundColor DarkGray
