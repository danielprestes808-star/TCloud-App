[CmdletBinding()]
param(
  [string]$ProjectRoot = "",
  [switch]$RequireSignature,
  [switch]$ReuseExistingBundle,
  [switch]$EnableUpdater
)
$ErrorActionPreference='Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw "Nao foi possivel localizar o proprio script para resolver ProjectRoot." }
  $scriptDir = Split-Path -Parent $scriptPath
  $ProjectRoot = Split-Path -Parent $scriptDir
}
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
Set-Location $ProjectRoot
$pkg=Get-Content (Join-Path $ProjectRoot 'package.json') -Raw|ConvertFrom-Json
$version=[string]$pkg.version
Write-Host "TCloud $version - Windows Distribution" -ForegroundColor Cyan

function Resolve-GitHubRepo {
  $git=Get-Command git -ErrorAction SilentlyContinue
  if(-not $git){return $null}
  $remote=(& git -C $ProjectRoot config --get remote.origin.url 2>$null|Select-Object -First 1)
  if([string]::IsNullOrWhiteSpace($remote)){return $null}
  $m=[regex]::Match($remote.Trim(),'github\.com[/:]([^/]+?)/([^/]+?)(?:\.git)?$')
  if(-not $m.Success){return $null}
  return ($m.Groups[1].Value+'/'+$m.Groups[2].Value)
}
function Resolve-UpdaterArtifactUrl([string]$Endpoint,[string]$FileName){
  $exact=([string]$env:TCLOUD_UPDATER_ARTIFACT_URL).Trim()
  if(-not [string]::IsNullOrWhiteSpace($exact)){
    return $exact.Replace('{{version}}',$version).Replace('{{filename}}',$FileName)
  }
  $base=([string]$env:TCLOUD_UPDATER_DOWNLOAD_BASE_URL).Trim()
  if(-not [string]::IsNullOrWhiteSpace($base)){
    return ($base.TrimEnd('/')+'/'+$FileName)
  }
  $m=[regex]::Match($Endpoint,'^https://github\.com/([^/]+)/([^/]+)/releases/latest/download/latest\.json$')
  if($m.Success){
    return ('https://github.com/'+$m.Groups[1].Value+'/'+$m.Groups[2].Value+'/releases/download/v'+$version+'/'+$FileName)
  }
  $repo=Resolve-GitHubRepo
  if($repo){return ('https://github.com/'+$repo+'/releases/download/v'+$version+'/'+$FileName)}
  throw 'Nao foi possivel determinar a URL HTTPS do instalador para latest.json. Configure TCLOUD_UPDATER_ARTIFACT_URL ou TCLOUD_UPDATER_DOWNLOAD_BASE_URL.'
}

Write-Host '[1/9] Preflight de distribuicao...' -ForegroundColor Cyan
$preflightArgs=@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $ProjectRoot 'scripts\release-preflight.ps1'))
if($RequireSignature){$preflightArgs += '-RequireSignature'}
& powershell @preflightArgs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($EnableUpdater){
  Write-Host '[2/9] Preflight do updater assinado...' -ForegroundColor Cyan
  try {
    & (Join-Path $ProjectRoot 'scripts\updater-preflight.ps1') -ProjectRoot $ProjectRoot
  } catch {
    throw ('Preflight do updater falhou: ' + $_.Exception.Message)
  }
}else{
  Write-Host '[2/9] Updater nao solicitado para este build candidato.' -ForegroundColor DarkYellow
}

$releaseConfig=Join-Path $ProjectRoot 'src-tauri\tauri.windows.release.conf.json'
$generatedSigningConfig=$null
$generatedUpdaterConfig=$null
$previousSigningKey=$env:TAURI_SIGNING_PRIVATE_KEY
$previousSigningPassword=$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$previousConfigured=$env:TCLOUD_UPDATER_CONFIGURED
$previousChannel=$env:TCLOUD_UPDATER_CHANNEL
$previousEndpointHost=$env:TCLOUD_UPDATER_ENDPOINT_HOST
try {
  if($RequireSignature){
    Write-Host '[3/9] Preparando assinatura Authenticode...' -ForegroundColor Cyan
    $config=Get-Content $releaseConfig -Raw|ConvertFrom-Json
    $thumbprint=([string]$env:TCLOUD_WINDOWS_CERT_THUMBPRINT).Replace(' ','').Trim()
    $timestampUrl=([string]$env:TCLOUD_WINDOWS_TIMESTAMP_URL).Trim()
    $digest=([string]$env:TCLOUD_WINDOWS_DIGEST_ALGORITHM).Trim().ToLowerInvariant()
    if([string]::IsNullOrWhiteSpace($digest)){$digest='sha256'}
    $config.bundle.windows | Add-Member -NotePropertyName certificateThumbprint -NotePropertyValue $thumbprint -Force
    $config.bundle.windows | Add-Member -NotePropertyName digestAlgorithm -NotePropertyValue $digest -Force
    $config.bundle.windows | Add-Member -NotePropertyName timestampUrl -NotePropertyValue $timestampUrl -Force
    $generatedSigningConfig=Join-Path $ProjectRoot 'src-tauri\.tauri.windows.release.generated.conf.json'
    $configJson=$config|ConvertTo-Json -Depth 30; [IO.File]::WriteAllText($generatedSigningConfig,$configJson,(New-Object Text.UTF8Encoding($false)))
    $releaseConfig=$generatedSigningConfig
    Write-Host '[OK] Configuracao temporaria de Authenticode pronta.' -ForegroundColor Green
  }else{
    Write-Host '[3/9] Build candidato sem exigencia de Authenticode.' -ForegroundColor DarkYellow
  }

  if($EnableUpdater){
    Write-Host '[4/9] Preparando endpoint, chave publica e artefatos do updater...' -ForegroundColor Cyan
    $private=([string]$env:TAURI_SIGNING_PRIVATE_KEY).Trim()
    if([string]::IsNullOrWhiteSpace($private)){
      $private=([string]$env:TCLOUD_UPDATER_PRIVATE_KEY_PATH).Trim()
      if([string]::IsNullOrWhiteSpace($private)){$private=Join-Path $env:USERPROFILE '.tcloud\updater\tcloud-updater.key'}
      if(-not (Test-Path -LiteralPath $private -PathType Leaf)){throw "Chave privada do updater ausente: $private"}
      $env:TAURI_SIGNING_PRIVATE_KEY=$private
    }
    if([string]::IsNullOrWhiteSpace([string]$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) -and -not [string]::IsNullOrWhiteSpace([string]$env:TCLOUD_UPDATER_KEY_PASSWORD)){
      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$env:TCLOUD_UPDATER_KEY_PASSWORD
    }
    $generatedUpdaterConfig=Join-Path $ProjectRoot 'src-tauri\.tauri.windows.updater.generated.conf.json'
    try {
      $null = & (Join-Path $ProjectRoot 'scripts\prepare-updater-config.ps1') -ProjectRoot $ProjectRoot -BaseConfigPath $releaseConfig -OutputPath $generatedUpdaterConfig
    } catch {
      throw ('Falha ao gerar configuracao de updater: ' + $_.Exception.Message)
    }
    if(-not (Test-Path -LiteralPath $generatedUpdaterConfig -PathType Leaf)){throw 'Configuracao gerada do updater nao foi criada.'}
    $releaseConfig=$generatedUpdaterConfig
    $updaterConfig=Get-Content $releaseConfig -Raw|ConvertFrom-Json
    $updaterEndpoint=[string](@($updaterConfig.plugins.updater.endpoints)[0])
    $env:TCLOUD_UPDATER_CONFIGURED='1'
    $env:TCLOUD_UPDATER_CHANNEL=$(if($RequireSignature){'stable'}else{'candidate'})
    try{$env:TCLOUD_UPDATER_ENDPOINT_HOST=([uri]$updaterEndpoint).Host}catch{$env:TCLOUD_UPDATER_ENDPOINT_HOST='configured'}
    Write-Host ('[OK] Updater configurado em '+$updaterEndpoint) -ForegroundColor Green
  }else{
    Write-Host '[4/9] Build sem artefatos de auto-update.' -ForegroundColor DarkYellow
  }

  if($ReuseExistingBundle){
    Write-Host '[5/9] Reutilizando bundle NSIS ja compilado...' -ForegroundColor DarkYellow
    $existingNsis=Join-Path $ProjectRoot 'src-tauri\target\release\bundle\nsis'
    $existingInstaller=Get-ChildItem $existingNsis -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
    if(-not $existingInstaller){throw 'Nenhum instalador NSIS existente foi encontrado para reutilizar.'}
    if($EnableUpdater -and -not (Test-Path -LiteralPath ($existingInstaller.FullName+'.sig') -PathType Leaf)){throw 'O bundle existente nao possui .sig do updater; gere novamente sem -ReuseExistingBundle.'}
    Write-Host ('Bundle existente: '+$existingInstaller.FullName) -ForegroundColor DarkGray
  }else{
    Write-Host '[5/9] Build NSIS de producao...' -ForegroundColor Cyan
    & node (Join-Path $ProjectRoot 'scripts\tauri-cli.cjs') build --config $releaseConfig
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  }

  Write-Host '[6/9] Verificando conteudo do bundle...' -ForegroundColor Cyan
  & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'scripts\verify-windows-bundle.ps1')
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}

  $nsis=Join-Path $ProjectRoot 'src-tauri\target\release\bundle\nsis'
  $installer=Get-ChildItem $nsis -Filter '*-setup.exe' -File|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
  if(-not $installer){throw 'Instalador NSIS nao encontrado.'}

  Write-Host '[7/9] Preparando artefatos e manifesto...' -ForegroundColor Cyan
  $release=Join-Path $ProjectRoot 'release-artifacts'
  New-Item -ItemType Directory -Path $release -Force|Out-Null
  $standardName='TCloud-'+$version+'-Windows-x64-Setup.exe'
  $out=Join-Path $release $standardName
  Copy-Item $installer.FullName $out -Force
  $hash=Get-FileHash $out -Algorithm SHA256
  $sig=Get-AuthenticodeSignature $out
  $signatureValid=$sig.Status -eq [System.Management.Automation.SignatureStatus]::Valid
  if($RequireSignature -and -not $signatureValid){throw 'Distribuicao publica bloqueada: o instalador final nao possui assinatura Authenticode valida.'}

  $updaterEndpoint=$null
  $updaterArtifactUrl=$null
  $updaterSigName=$null
  if($EnableUpdater){
    $sourceSig=$installer.FullName+'.sig'
    if(-not (Test-Path -LiteralPath $sourceSig -PathType Leaf)){throw 'Assinatura .sig do updater nao foi produzida pelo Tauri.'}
    $signatureText=(Get-Content -LiteralPath $sourceSig -Raw).Trim()
    if([string]::IsNullOrWhiteSpace($signatureText)){throw 'Assinatura .sig do updater esta vazia.'}
    $updaterSigName=$standardName+'.sig'
    Copy-Item $sourceSig (Join-Path $release $updaterSigName) -Force
    $cfg=Get-Content $releaseConfig -Raw|ConvertFrom-Json
    $updaterEndpoint=[string](@($cfg.plugins.updater.endpoints)[0])
    $updaterArtifactUrl=Resolve-UpdaterArtifactUrl $updaterEndpoint $standardName
    if($updaterArtifactUrl -notmatch '^https://'){throw 'URL final do artefato do updater deve usar HTTPS.'}
    $latest=[ordered]@{
      version=$version
      notes=('TCloud '+$version+' — atualizacao automatica assinada.')
      pub_date=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
      platforms=[ordered]@{
        'windows-x86_64'=[ordered]@{signature=$signatureText;url=$updaterArtifactUrl}
      }
    }
    $latestJson=$latest|ConvertTo-Json -Depth 10; [IO.File]::WriteAllText((Join-Path $release 'latest.json'),$latestJson,(New-Object Text.UTF8Encoding($false)))
    $pubkey=[string]$cfg.plugins.updater.pubkey
    Set-Content (Join-Path $release 'TCloud-Updater-Public-Key.txt') $pubkey -Encoding UTF8
    Write-Host '[OK] latest.json e assinatura do updater gerados.' -ForegroundColor Green
  }

  $metadata=[ordered]@{
    product='TCloud'
    version=$version
    channel=$(if($RequireSignature){'public'}else{'candidate'})
    architecture='x64'
    minimum_windows_build=19041
    installer_scope='currentUser'
    installer=[IO.Path]::GetFileName($out)
    bytes=[int64](Get-Item $out).Length
    sha256=$hash.Hash
    authenticode_status=[string]$sig.Status
    signer=$(if($sig.SignerCertificate){$sig.SignerCertificate.Subject}else{$null})
    updater_enabled=[bool]$EnableUpdater
    updater_manifest=$(if($EnableUpdater){'latest.json'}else{$null})
    updater_signature=$updaterSigName
    updater_endpoint=$updaterEndpoint
    updater_artifact_url=$updaterArtifactUrl
    created_at=(Get-Date).ToString('o')
  }
  $metadataJson=$metadata|ConvertTo-Json -Depth 8; [IO.File]::WriteAllText((Join-Path $release ('TCloud-'+$version+'-Windows-x64.json')),$metadataJson,(New-Object Text.UTF8Encoding($false)))
  Set-Content ($out+'.sha256.txt') ($hash.Hash+'  '+[IO.Path]::GetFileName($out)) -Encoding ASCII
  Copy-Item (Join-Path $ProjectRoot 'scripts\verify-installed-windows.ps1') (Join-Path $release 'Verificar-TCloud-Instalado.ps1') -Force

  Write-Host '[8/9] Validando assinaturas...' -ForegroundColor Cyan
  if($signatureValid){Write-Host ('Authenticode valido: '+$sig.SignerCertificate.Subject) -ForegroundColor Green}
  else{Write-Host ('[AVISO] Instalador sem Authenticode publico ('+[string]$sig.Status+').') -ForegroundColor Yellow}
  if($EnableUpdater){
    $latestCheck=Get-Content (Join-Path $release 'latest.json') -Raw|ConvertFrom-Json
    if([string]$latestCheck.version -ne $version){throw 'latest.json possui versao incorreta.'}
    if([string]::IsNullOrWhiteSpace([string]$latestCheck.platforms.'windows-x86_64'.signature)){throw 'latest.json sem assinatura.'}
    Write-Host '[OK] Assinatura minisign do updater incorporada ao latest.json.' -ForegroundColor Green
  }

  Write-Host '[9/9] Distribuicao preparada.' -ForegroundColor Green
  Write-Host ('Instalador: '+$out) -ForegroundColor Green
  Write-Host ('SHA256: '+$hash.Hash) -ForegroundColor Cyan
  if($EnableUpdater){
    Write-Host ('Updater: '+(Join-Path $release 'latest.json')) -ForegroundColor Cyan
    Write-Host ('Publique latest.json, '+$standardName+' e '+$updaterSigName+' no endpoint configurado.') -ForegroundColor Cyan
  }
  if(-not $RequireSignature){Write-Host 'Para Stable publica assinada + auto-update use: npm run release:windows:public' -ForegroundColor DarkYellow}
} finally {
  if($generatedUpdaterConfig -and (Test-Path $generatedUpdaterConfig -PathType Leaf)){Remove-Item $generatedUpdaterConfig -Force -ErrorAction SilentlyContinue}
  if($generatedSigningConfig -and (Test-Path $generatedSigningConfig -PathType Leaf)){Remove-Item $generatedSigningConfig -Force -ErrorAction SilentlyContinue}
  $env:TAURI_SIGNING_PRIVATE_KEY=$previousSigningKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$previousSigningPassword
  $env:TCLOUD_UPDATER_CONFIGURED=$previousConfigured
  $env:TCLOUD_UPDATER_CHANNEL=$previousChannel
  $env:TCLOUD_UPDATER_ENDPOINT_HOST=$previousEndpointHost
}
