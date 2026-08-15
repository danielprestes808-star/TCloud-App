# TCloud 13.0.9 — Build Hotfix 3

Correção do encerramento imediato no startup causado pela inicialização do `tauri-plugin-updater` sem objeto de configuração.

## Correções

- `src-tauri/tauri.conf.json` agora contém uma configuração segura e inerte para o updater no build normal:
  - `pubkey: ""`
  - `endpoints: []`
- Sem endpoint, o build local não consulta rede nem tenta instalar atualização.
- Releases com updater continuam usando `scripts/prepare-updater-config.ps1`, que injeta a chave pública real e o endpoint HTTPS no arquivo de configuração de release gerado.
- `scripts/run-tauri-shell.ps1` agora mostra `%LOCALAPPDATA%\\TCloud\\logs\\startup.log` quando o lançamento por Package Identity não propaga `TCLOUD_STARTUP_LOG`.

## Causa confirmada

O log local registrou:

`PluginInitialization("updater", "Error deserializing 'plugins.updater' ... invalid type: null, expected struct Config")`

O plugin Tauri requer que `plugins.updater` seja um objeto de configuração. Um objeto com endpoints vazios é válido para o staging e mantém o atualizador desativado até a configuração de release real ser gerada.
