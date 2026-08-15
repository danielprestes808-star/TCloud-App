[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [string]$BaseConfigPath = "",
  [string]$OutputPath = ""
)
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'Nao foi possivel localizar o proprio script.' }
  $ProjectRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if ([string]::IsNullOrWhiteSpace($BaseConfigPath)) { $BaseConfigPath = Join-Path $ProjectRoot 'src-tauri\tauri.windows.release.conf.json' }
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $ProjectRoot 'src-tauri\.tauri.windows.updater.generated.conf.json' }

function Resolve-GitHubRepo {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { return $null }
  $remote = (& git -C $ProjectRoot config --get remote.origin.url 2>$null | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($remote)) { return $null }
  $remote = $remote.Trim()
  $m = [regex]::Match($remote, 'github\.com[/:]([^/]+?)/([^/]+?)(?:\.git)?$')
  if (-not $m.Success) { return $null }
  return ($m.Groups[1].Value + '/' + $m.Groups[2].Value)
}

$pubkey = ([string]$env:TCLOUD_UPDATER_PUBLIC_KEY).Trim()
if ([string]::IsNullOrWhiteSpace($pubkey)) {
  $pubPath = ([string]$env:TCLOUD_UPDATER_PUBLIC_KEY_PATH).Trim()
  if ([string]::IsNullOrWhiteSpace($pubPath)) {
    $pubPath = Join-Path $env:USERPROFILE '.tcloud\updater\tcloud-updater.key.pub'
  }
  if (-not (Test-Path -LiteralPath $pubPath -PathType Leaf)) {
    throw "Chave publica do updater nao encontrada. Rode 'npm run updater:keygen' ou configure TCLOUD_UPDATER_PUBLIC_KEY/TCLOUD_UPDATER_PUBLIC_KEY_PATH."
  }
  $pubkey = (Get-Content -LiteralPath $pubPath -Raw).Trim()
}
if ($pubkey.Length -lt 32) { throw 'Chave publica do updater parece invalida ou vazia.' }

$endpoint = ([string]$env:TCLOUD_UPDATER_ENDPOINT).Trim()
$endpointSource = 'TCLOUD_UPDATER_ENDPOINT'
if ([string]::IsNullOrWhiteSpace($endpoint)) {
  $repo = Resolve-GitHubRepo
  if ($repo) {
    $endpoint = "https://github.com/$repo/releases/latest/download/latest.json"
    $endpointSource = 'remote.origin GitHub (' + $repo + ')'
  }
}
if ([string]::IsNullOrWhiteSpace($endpoint)) {
  throw "Endpoint HTTPS do updater ausente. A assinatura esta pronta, mas falta onde publicar as atualizacoes. Configure TCLOUD_UPDATER_ENDPOINT ou defina um remote.origin GitHub. Exemplo: `$env:TCLOUD_UPDATER_ENDPOINT='https://github.com/USUARIO/REPOSITORIO/releases/latest/download/latest.json'"
}
if ($endpoint -notmatch '^https://') { throw 'TCLOUD_UPDATER_ENDPOINT deve usar HTTPS em release.' }

$config = Get-Content -LiteralPath $BaseConfigPath -Raw | ConvertFrom-Json
if ($null -eq $config.bundle) { $config | Add-Member -NotePropertyName bundle -NotePropertyValue ([pscustomobject]@{}) -Force }
$config.bundle | Add-Member -NotePropertyName createUpdaterArtifacts -NotePropertyValue $true -Force
if ($null -eq $config.plugins) { $config | Add-Member -NotePropertyName plugins -NotePropertyValue ([pscustomobject]@{}) -Force }
$updater = [pscustomobject]@{
  pubkey = $pubkey
  endpoints = @($endpoint)
  windows = [pscustomobject]@{ installMode = 'passive' }
}
$config.plugins | Add-Member -NotePropertyName updater -NotePropertyValue $updater -Force
$config | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host '[OK] Configuracao de updater gerada.' -ForegroundColor Green
Write-Host ('Endpoint: ' + $endpoint) -ForegroundColor DarkGray
Write-Host ('Origem do endpoint: ' + $endpointSource) -ForegroundColor DarkGray
Write-Host ('Arquivo: ' + $OutputPath) -ForegroundColor DarkGray
Write-Output $OutputPath
