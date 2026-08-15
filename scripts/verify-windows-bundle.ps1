[CmdletBinding()]
param(
  [string]$TauriRoot = ""
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($TauriRoot)) {
  $scriptPath = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { $scriptPath = $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw "Nao foi possivel localizar o proprio script para resolver TauriRoot." }
  $scriptDir = Split-Path -Parent $scriptPath
  $TauriRoot = Join-Path (Split-Path -Parent $scriptDir) "src-tauri"
}
$TauriRoot = [System.IO.Path]::GetFullPath($TauriRoot)

$resolvedTauriRoot = [System.IO.Path]::GetFullPath($TauriRoot)
$projectRoot = Split-Path -Parent $resolvedTauriRoot
$runtimePath = Join-Path $resolvedTauriRoot "resources/vc_redist.x64.exe"
$releaseDirectory = Join-Path $resolvedTauriRoot "target/release"
$nsisDirectory = Join-Path $releaseDirectory "bundle/nsis"
$releaseConfigPath = Join-Path $resolvedTauriRoot "tauri.windows.release.conf.json"

if (-not (Test-Path $runtimePath -PathType Leaf)) {
  throw "The prepared Visual C++ redistributable is missing: $runtimePath"
}

$runtimeSignature = Get-AuthenticodeSignature -FilePath $runtimePath
if ($runtimeSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $runtimeSignature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
  throw "The bundled Visual C++ redistributable does not have a valid Microsoft Authenticode signature."
}

$installer = Get-ChildItem -Path $nsisDirectory -Filter "*-setup.exe" -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "No NSIS setup executable was produced under $nsisDirectory."
}

# Basic validation that does not require third-party tools.
if ($installer.Length -lt 1MB) {
  throw "The NSIS installer is unexpectedly small ($($installer.Length) bytes): $($installer.FullName)"
}
$stream = [System.IO.File]::OpenRead($installer.FullName)
try {
  $mz = New-Object byte[] 2
  $read = $stream.Read($mz, 0, 2)
  if ($read -ne 2 -or $mz[0] -ne 0x4D -or $mz[1] -ne 0x5A) {
    throw "The produced installer is not a valid Windows PE executable (MZ header missing)."
  }
}
finally {
  $stream.Dispose()
}
$installerHash = Get-FileHash -Path $installer.FullName -Algorithm SHA256
if ([string]::IsNullOrWhiteSpace($installerHash.Hash)) {
  throw "Could not calculate SHA256 for the produced installer."
}

# Deep NSIS inspection is useful, but 7-Zip is not a build requirement.
# Try common locations; if unavailable, validate the exact Tauri resource/hook inputs
# that produced the installer instead of aborting the release.
$sevenZipCandidates = @()
$sevenZipCommand = Get-Command 7z -ErrorAction SilentlyContinue
if ($sevenZipCommand -and $sevenZipCommand.Source) { $sevenZipCandidates += $sevenZipCommand.Source }
if ($env:ProgramFiles) { $sevenZipCandidates += (Join-Path $env:ProgramFiles "7-Zip/7z.exe") }
if (${env:ProgramFiles(x86)}) { $sevenZipCandidates += (Join-Path ${env:ProgramFiles(x86)} "7-Zip/7z.exe") }
if ($env:ChocolateyInstall) { $sevenZipCandidates += (Join-Path $env:ChocolateyInstall "bin/7z.exe") }
if ($env:USERPROFILE) {
  $sevenZipCandidates += (Join-Path $env:USERPROFILE "scoop/apps/7zip/current/7z.exe")
  $sevenZipCandidates += (Join-Path $env:USERPROFILE "scoop/shims/7z.exe")
}
$sevenZipPath = $sevenZipCandidates |
  Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } |
  Select-Object -First 1

if ($sevenZipPath) {
  Write-Host "7-Zip found; performing deep NSIS content inspection: $sevenZipPath" -ForegroundColor DarkGray
  $archiveListing = & $sevenZipPath l $installer.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip could not inspect the NSIS installer (exit code $LASTEXITCODE)."
  }
  $listingText = $archiveListing -join "`n"
  if ($listingText -notmatch "vc_redist\.x64\.exe") {
    throw "The finished NSIS installer does not contain vc_redist.x64.exe."
  }
  if ($listingText -notmatch "tcloud\.exe") {
    throw "The finished NSIS installer does not contain tcloud.exe."
  }
  Write-Host "[OK] Deep NSIS inspection confirmed tcloud.exe and vc_redist.x64.exe." -ForegroundColor Green
}
else {
  Write-Host "[INFO] 7-Zip is unavailable; using dependency-free bundle verification." -ForegroundColor Yellow
  if (-not (Test-Path $releaseConfigPath -PathType Leaf)) {
    throw "Release configuration is missing: $releaseConfigPath"
  }
  $releaseConfig = Get-Content $releaseConfigPath -Raw | ConvertFrom-Json
  $resources = @($releaseConfig.bundle.resources)
  if (-not ($resources -contains "resources/vc_redist.x64.exe")) {
    throw "Release configuration does not bundle resources/vc_redist.x64.exe."
  }
  $hooksRelative = [string]$releaseConfig.bundle.windows.nsis.installerHooks
  if ([string]::IsNullOrWhiteSpace($hooksRelative)) {
    throw "Release configuration does not define the NSIS installer hook."
  }
  $hooksRelativeNormalized = $hooksRelative -replace '^[.][\\/]', ''
  $hooksPath = Join-Path $resolvedTauriRoot $hooksRelativeNormalized
  if (-not (Test-Path $hooksPath -PathType Leaf)) {
    throw "Configured NSIS installer hook is missing: $hooksPath"
  }
  $hooksText = Get-Content $hooksPath -Raw
  if ($hooksText -notmatch [regex]::Escape('resources\vc_redist.x64.exe')) {
    throw "NSIS installer hook does not reference the bundled Visual C++ runtime."
  }
  if ($hooksText -notmatch 'NSIS_HOOK_POSTINSTALL') {
    throw "NSIS installer hook does not define NSIS_HOOK_POSTINSTALL."
  }
  Write-Host "[OK] Release config and NSIS hook confirm the Microsoft runtime is bundled and installed post-install." -ForegroundColor Green
  Write-Host "[INFO] Deep archive listing was skipped only because 7-Zip is not installed; this is not a release blocker." -ForegroundColor DarkYellow
}

$packagePath = Join-Path $projectRoot "package.json"
if (Test-Path $packagePath -PathType Leaf) {
  $package = Get-Content $packagePath -Raw | ConvertFrom-Json
  if ($installer.Name -notmatch [regex]::Escape([string]$package.version)) {
    Write-Host ("WARNING: installer filename does not contain package version " + $package.version) -ForegroundColor Yellow
  }
}

$application = Get-ChildItem -Path $releaseDirectory -Filter "*.exe" -File |
  Where-Object { $_.Name -notlike "*-setup.exe" } |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $application) {
  throw "No Windows application executable was produced under $releaseDirectory."
}

# The application must also be a Windows PE executable.
$appStream = [System.IO.File]::OpenRead($application.FullName)
try {
  $appMz = New-Object byte[] 2
  $appRead = $appStream.Read($appMz, 0, 2)
  if ($appRead -ne 2 -or $appMz[0] -ne 0x4D -or $appMz[1] -ne 0x5A) {
    throw "The produced TCloud application is not a valid Windows PE executable."
  }
}
finally {
  $appStream.Dispose()
}

# dumpbin is available on normal Rust/MSVC build machines and gives us a useful
# dependency report. Do not make it a hard dependency for bundle verification.
$dependencyInspectionDone = $false
$vswhere = $null
if (${env:ProgramFiles(x86)}) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
}
if ($vswhere -and (Test-Path $vswhere -PathType Leaf)) {
  $visualStudioPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if ($visualStudioPath) {
    $toolsVersionFile = Join-Path $visualStudioPath "VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt"
    if (Test-Path $toolsVersionFile -PathType Leaf) {
      $toolsVersion = (Get-Content $toolsVersionFile -Raw).Trim()
      $dumpbin = Join-Path $visualStudioPath "VC/Tools/MSVC/$toolsVersion/bin/Hostx64/x64/dumpbin.exe"
      if (Test-Path $dumpbin -PathType Leaf) {
        $dependencies = & $dumpbin /DEPENDENTS $application.FullName
        if ($LASTEXITCODE -eq 0) {
          $dependencyInspectionDone = $true
          Write-Host "PE dependencies for $($application.Name):"
          $dependencies | Write-Host
        }
        else {
          Write-Host "[AVISO] dumpbin returned exit code $LASTEXITCODE; continuing because PE/basic bundle checks passed." -ForegroundColor Yellow
        }
      }
    }
  }
}
if (-not $dependencyInspectionDone) {
  Write-Host "[INFO] Visual Studio dumpbin dependency inspection unavailable; PE/basic bundle checks passed." -ForegroundColor DarkGray
}

Write-Host "Verified Windows installer: $($installer.FullName)" -ForegroundColor Green
Write-Host "Installer size: $($installer.Length) bytes" -ForegroundColor DarkGray
Write-Host "Installer SHA256: $($installerHash.Hash)" -ForegroundColor DarkGray
Write-Host "Verified bundled Microsoft runtime: $runtimePath" -ForegroundColor Green
