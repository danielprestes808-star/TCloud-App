# TCloud 13.0.9 — Build Hotfix 4

## Correção

O pipeline `release:windows:update` podia encerrar silenciosamente depois do preflight da chave privada quando a preparação do endpoint do updater falhava dentro de um processo PowerShell aninhado.

Este hotfix:

- propaga erros do updater diretamente para o terminal;
- deixa de depender de `$LASTEXITCODE` em chamadas PowerShell aninhadas nessa etapa;
- mostra claramente quando falta o endpoint HTTPS;
- informa a origem do endpoint quando ele é resolvido por `TCLOUD_UPDATER_ENDPOINT` ou por `remote.origin` do GitHub;
- mantém a exigência de HTTPS e assinatura do updater.

## Próximo requisito externo

Para gerar uma release de auto-update é necessário um endpoint HTTPS real que hospede `latest.json` e o instalador assinado. O TCloud aceita:

- `TCLOUD_UPDATER_ENDPOINT`; ou
- um `remote.origin` GitHub, do qual o endpoint de GitHub Releases é derivado automaticamente.

Nenhuma chave privada é incluída neste hotfix.
