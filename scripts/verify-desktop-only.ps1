$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

# TCloud 13.0.1 hotfix:
# A ZIP patch cannot delete files that already existed in an older installation.
# These paths are legacy mobile/JNI files that were removed from the clean
# desktop-only source tree, but may remain after extracting a patch over 12.x.
$legacyMobilePaths = @(
    'src\components\mobile',
    'src\hooks\usePlatform.ts',
    'src\pages\TCloudPairingPage.tsx',
    'src-tauri\src\jni_cache.rs',
    'src-tauri\src\mobile_api.rs',
    'src-tauri\src\mobile_server.rs',
    'src-tauri\src\tcloud_mdns.rs',
    'src-tauri\src\upload_service.rs',
    'src-tauri\src\webdav.rs',
    'src-tauri\src\commands\tcloud_firewall.rs',
    'src-tauri\src\commands\tcloud_mobile_server.rs',
    'src-tauri\src\commands\webdav_settings.rs'
)

$removed = @()
foreach ($relativePath in $legacyMobilePaths) {
    $fullPath = Join-Path $root $relativePath
    if (Test-Path $fullPath) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force
        $removed += $relativePath
    }
}

if ($removed.Count -gt 0) {
    Write-Host '[TCloud] Residuos mobile antigos removidos da instalacao desktop:' -ForegroundColor Yellow
    $removed | ForEach-Object { Write-Host ("  - {0}" -f $_) }
}

$targets = @(
    (Join-Path $root 'src'),
    (Join-Path $root 'src-tauri\src'),
    (Join-Path $root 'src-tauri\build.rs'),
    (Join-Path $root 'src-tauri\Cargo.toml')
)

$pattern = '(?i)\b(android|ios|mobile|jni|ndk_context|ndk-context|mediastore)\b'
$matches = @()

foreach ($target in $targets) {
    if (Test-Path $target -PathType Container) {
        $files = Get-ChildItem -Path $target -Recurse -File | Where-Object {
            $_.Extension -in @('.rs', '.ts', '.tsx', '.js', '.cjs', '.json', '.toml')
        }
        if ($files) {
            $matches += $files | Select-String -Pattern $pattern
        }
    }
    elseif (Test-Path $target -PathType Leaf) {
        $matches += Select-String -Path $target -Pattern $pattern
    }
}

if ($matches.Count -gt 0) {
    Write-Host '[TCloud] Falha: referencias mobile encontradas na arvore de producao.' -ForegroundColor Red
    $matches | ForEach-Object {
        Write-Host ("{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim())
    }
    exit 1
}

Write-Host '[TCloud] Desktop-only verificado: nenhuma referencia Android/iOS/JNI na arvore de producao.' -ForegroundColor Green
