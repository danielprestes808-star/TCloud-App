param(
    [string]$Root = "$env:USERPROFILE\TCloud"
)

$ErrorActionPreference = "Continue"
Write-Host "=== TCloud 12.7.2 - Explorer Integration Check ===" -ForegroundColor Cyan

function Result($Name, $Ok, $Detail) {
    $mark = if ($Ok) { "[OK]" } else { "[!]" }
    $color = if ($Ok) { "Green" } else { "Yellow" }
    Write-Host "$mark $Name - $Detail" -ForegroundColor $color
}

Result "Pasta TCloud" (Test-Path $Root) $Root

$processes = @(Get-Process -Name "tcloud" -ErrorAction SilentlyContinue)
Result "Instancia unica" ($processes.Count -le 1) ("processos tcloud.exe: " + $processes.Count)

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$startup = $null
try {
    $startup = (Get-ItemProperty -Path $runKey -Name "TCloud" -ErrorAction Stop).TCloud
} catch {}
Result "Inicio com Windows" ($null -ne $startup) ($(if ($startup) { $startup } else { "desativado" }))

$fallbackFile = Test-Path "HKCU:\Software\Classes\*\shell\TCloudKeepOffline"
$fallbackDir = Test-Path "HKCU:\Software\Classes\Directory\shell\TCloudKeepOffline"
Write-Host ("[i] Menu compatível registrado: arquivo={0}, pasta={1}" -f $fallbackFile,$fallbackDir)

if (Test-Path $Root) {
    $sample = Get-ChildItem -Path $Root -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($sample) {
        Write-Host "[i] Exemplo de arquivo: $($sample.FullName)"
        cmd /c attrib "$($sample.FullName)"
    } else {
        Write-Host "[i] Nenhum arquivo encontrado para inspecionar atributos."
    }
}

Write-Host ""
Write-Host "Validação manual final:" -ForegroundColor Cyan
Write-Host "  1. Clique com botão direito em um arquivo TCloud."
Write-Host "  2. Teste Sempre manter neste dispositivo / Liberar espaço."
Write-Host "  3. Reinicie o Windows e confirme que o TCloud continua na bandeja."
Write-Host "  4. Em Configurações > Visão geral, clique em Verificar arquivos."
