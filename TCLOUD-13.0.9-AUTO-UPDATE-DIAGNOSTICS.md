# TCloud 13.0.9 — Auto Update & Diagnostics

Esta versão fecha a infraestrutura de atualização automática assinada do cliente Windows e amplia o diagnóstico seguro.

## O que foi implementado

- `tauri-plugin-updater` registrado no backend Rust e liberado pela capability `updater:default`.
- Configuração do updater é gerada **somente para release**, mantendo desenvolvimento e `tauri:shell` independentes de servidor de atualização.
- `createUpdaterArtifacts=true` é ativado apenas no build de updater.
- Chave privada do updater fica por padrão em `%USERPROFILE%\.tcloud\updater\tcloud-updater.key`, fora do projeto.
- O aplicativo recebe apenas a chave pública.
- Endpoint de atualização exige HTTPS.
- Suporte automático a GitHub Releases quando `remote.origin` aponta para GitHub.
- Geração de `latest.json`, `.sig`, SHA-256 e metadados de release.
- `release:windows:public` agora exige a combinação: Authenticode válido + assinatura do updater.
- Workflow GitHub atualizado para Windows-only/TCloud e publicação de artefatos de updater.
- Diagnóstico ZIP informa se o updater foi configurado no build, canal e host do endpoint, sem incluir chaves, credenciais ou conteúdo pessoal.
- Diagnóstico profundo ganhou teste “Atualizador”.
- Mensagens de updater ausente em desenvolvimento deixam de parecer falha do armazenamento/sincronização.

## Preparação inicial — uma única vez

```powershell
cd D:\TCloud\app
npm run updater:toolchain
npm run updater:keygen
```

`updater:keygen` cria o par de chaves fora do projeto. **Nunca publique a chave privada.**

Se o projeto estiver em um repositório GitHub com `origin` configurado, o endpoint padrão será:

```text
https://github.com/OWNER/REPO/releases/latest/download/latest.json
```

Se não estiver, configure manualmente:

```powershell
$env:TCLOUD_UPDATER_ENDPOINT="https://seu-dominio.example/tcloud/latest.json"
$env:TCLOUD_UPDATER_ARTIFACT_URL="https://seu-dominio.example/tcloud/TCloud-13.0.9-Windows-x64-Setup.exe"
```

## Validar updater

```powershell
npm run updater:preflight
```

## Build interno com updater assinado

```powershell
npm run release:windows:update
```

Esse build exige a assinatura do updater, mas não exige Authenticode público.

## Build público

Configure o certificado Authenticode como na 13.0.8 e execute:

```powershell
npm run release:windows:public
```

Saída em `release-artifacts`:

- `TCloud-13.0.9-Windows-x64-Setup.exe`
- `TCloud-13.0.9-Windows-x64-Setup.exe.sig`
- `TCloud-13.0.9-Windows-x64-Setup.exe.sha256.txt`
- `latest.json`
- `TCloud-13.0.9-Windows-x64.json`
- `TCloud-Updater-Public-Key.txt`
- `Verificar-TCloud-Instalado.ps1`

## GitHub Actions

O workflow `.github/workflows/release.yml` foi reduzido ao cliente Windows e espera estes Secrets:

- `TCLOUD_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (se houver)
- `TCLOUD_WINDOWS_CERTIFICATE_BASE64`
- `TCLOUD_WINDOWS_CERTIFICATE_PASSWORD`
- `TCLOUD_TELEGRAM_API_ID`
- `TCLOUD_TELEGRAM_API_HASH`

Variável opcional:

- `TCLOUD_WINDOWS_TIMESTAMP_URL`

## Segurança

A chave privada do updater não é copiada para `release-artifacts`, ZIP do diagnóstico, frontend ou configuração Tauri final. O `latest.json` contém somente a assinatura pública do artefato e sua URL HTTPS.
