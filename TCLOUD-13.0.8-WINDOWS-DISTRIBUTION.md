# TCloud 13.0.8 — Windows Distribution

Esta etapa prepara o cliente desktop para sair do fluxo de desenvolvimento e gerar um instalador Windows reproduzível.

## O que foi fechado

- Versão 13.0.8 sincronizada entre `package.json`, Tauri, Cargo e `Package.appxmanifest`.
- Metadados Rust corrigidos para TCloud Development.
- Configuração de release separada do ambiente de desenvolvimento.
- DevTools ficam desligados no build de distribuição.
- Instalador NSIS explicitamente `currentUser`, evitando exigir administrador para a instalação principal.
- Instalador com Português do Brasil e Inglês; o Windows escolhe o idioma compatível.
- Ícone TCloud definido para instalador e desinstalador.
- WebView2 Bootstrapper continua embutido no instalador.
- Microsoft Visual C++ Runtime continua sendo baixado do endereço oficial e aceito somente após validação Authenticode da Microsoft.
- `.env.tcloud` passou a ser explicitamente ignorado pelo Git para não versionar API ID/API hash locais.
- Novo preflight valida Windows, arquitetura, ferramentas, versões, assets, credenciais, runtime e configuração de release antes do bundle.
- `release:windows` gera instalador + SHA-256 + manifesto JSON + verificador pós-instalação.
- `release:windows:public` bloqueia a release se o instalador não estiver assinado com Authenticode válido.
- `release:installed-check` audita instalação, Runtime VC++, WebView2, startup e raiz TCloud.

## Comandos

### Preparar/verificar ambiente

```powershell
npm run release:preflight
```

### Gerar candidato instalável

```powershell
npm run release:windows
```

Artefatos são gravados em `app/release-artifacts`.

### Gerar release pública

```powershell
npm run release:windows:public
```

Esse comando exige assinatura Authenticode válida. Sem certificado/configuração de assinatura, o instalador pode ser usado em testes locais, mas a publicação pública é bloqueada.

### Depois de instalar

```powershell
npm run release:installed-check
```

O mesmo script é copiado para `release-artifacts/Verificar-TCloud-Instalado.ps1`.

## Observação sobre atualização

A atualização automática continua separada desta etapa. A 13.0.8 prepara o instalador e o pipeline local; endpoint HTTPS, manifesto do updater e assinatura do updater entram na etapa seguinte.

## Assinatura da versão pública

O pipeline público aceita um certificado de assinatura já instalado no repositório de certificados do Windows. Antes de executar `npm run release:windows:public`, defina:

```powershell
$env:TCLOUD_WINDOWS_CERT_THUMBPRINT="THUMBPRINT_DO_CERTIFICADO"
$env:TCLOUD_WINDOWS_TIMESTAMP_URL="https://servidor-de-timestamp-do-emissor"
$env:TCLOUD_WINDOWS_DIGEST_ALGORITHM="sha256"
npm run release:windows:public
```

O preflight confirma que o certificado existe, ainda é válido e possui chave privada. A configuração de assinatura é gerada temporariamente e removida ao terminar; certificado e chave não são copiados para o projeto.

## Desinstalação e arquivos na nuvem

O instalador remove o aplicativo e os atalhos normalmente. O TCloud não força, pelo instalador, uma remoção destrutiva do Sync Root do Explorer, porque arquivos `Somente na nuvem` não contêm seus bytes completos localmente. Para remover também a integração do Explorer, use primeiro **Configurações > TCloud no Windows > Desconectar este computador** e depois desinstale o aplicativo. Os arquivos remotos no Telegram não são apagados por esse procedimento.
