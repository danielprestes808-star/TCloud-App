# TCloud 13.0.4 — File Grid & Attention Cleanup

- Início usa uma grade compacta de até 12 arquivos com nome, tamanho e estado, sem cards vazios gigantes.
- Falhas antigas superseded por tentativas mais novas deixam de contar em “Precisa de atenção”.
- Contadores de atenção consideram apenas a tentativa mais recente por arquivo + operação.
- Fila CFAPI usa a mesma regra para operações superseded.
- Tela “Precisa de atenção” pode limpar registros históricos já resolvidos sem apagar arquivos do usuário.
- “Tentar novamente” reenfileira todos os problemas atuais, não apenas os 100 itens recentes.
- Configurações usa o resumo leve de sincronização em vez de carregar a lista completa de atividades a cada atualização.
- Polling do Início desacelera quando existem apenas falhas estáticas e nenhuma transferência ativa.
- Tray e Dashboard técnico usam a mesma definição de falha acionável.
- Nenhuma dependência foi adicionada.
