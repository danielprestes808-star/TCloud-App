# TCloud 13.0.9 — Auto Update & Diagnostics

Código do cliente desktop Windows do TCloud.

## Desenvolvimento

```powershell
cd D:\TCloud\app
npm run tauri:shell
```

## Release Candidate

```powershell
npm run rc:check
```

## Instalador Windows normal

```powershell
npm run release:windows
```

## Preparar atualização automática

```powershell
npm run updater:toolchain
npm run updater:keygen
npm run updater:preflight
```

## Instalador com updater assinado

```powershell
npm run release:windows:update
```

## Release pública: Authenticode + updater

```powershell
npm run release:windows:public
```

Detalhes: `TCLOUD-13.0.9-AUTO-UPDATE-DIAGNOSTICS.md`.

Não remova `Package.appxmanifest`, `Assets`, `src-tauri/icons`, `src-tauri/windows` ou os scripts referenciados por `package.json`: eles participam do Package Identity, CFAPI, instalador ou updater.
