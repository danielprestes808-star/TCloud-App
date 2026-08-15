# TCloud 13.0.7 — Release Candidate

Esta versão consolida os mecanismos de estabilidade antes da distribuição.

## Gate automatizado

Execute `npm run rc:check`. O comando valida desktop-only, TypeScript/Vite, Rust e o smoke test do Windows e grava um relatório JSON em `stability-results`.

Para um teste de sessão longa: `powershell -ExecutionPolicy Bypass -File scripts/release-candidate.ps1 -SoakMinutes 30`.

## Cenários manuais obrigatórios

- interromper internet durante upload e download;
- encerrar `tcloud.exe` durante uma transferência e abrir novamente;
- reiniciar o Windows com fila pendente;
- abrir arquivo cloud-only pelo Explorer e confirmar hidratação apenas sob demanda;
- marcar e desmarcar “Sempre manter neste dispositivo”;
- renomear, mover, excluir e restaurar arquivos no Explorer;
- criar, bloquear e desbloquear o Cofre;
- testar arquivo grande e lote com milhares de arquivos;
- deixar o TCloud aberto por várias horas e observar RAM, handles e WAL.

O gate automatizado não substitui estes testes reais no Windows.
