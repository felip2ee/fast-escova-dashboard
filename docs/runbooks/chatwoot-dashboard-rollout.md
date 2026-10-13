# Rollout da integração Chatwoot no dashboard

Este procedimento é um gate de produção. Interrompa a implantação se uma etapa falhar ou se a reconciliação divergir sem uma explicação registrada.

## 1. Pré-requisitos e backup

1. Abra uma janela de mudança e registre a imagem atualmente implantada.
2. Faça backup verificável do banco indicado por `DATABASE_URL`, incluindo os schemas `disparos` e `dashboard_analytics` caso este já exista.
3. Confirme que existe espaço para a projeção histórica e que o backup pode ser restaurado.
4. Não altere nem remova dados do Chatwoot durante este processo.

## 2. Papel somente leitura no Chatwoot

Crie uma credencial exclusiva. Adapte nomes e política de senha ao ambiente:

```sql
CREATE ROLE fast_dashboard_chatwoot_ro LOGIN PASSWORD '<senha-gerenciada>';
GRANT CONNECT ON DATABASE chatwoot TO fast_dashboard_chatwoot_ro;
GRANT USAGE ON SCHEMA public TO fast_dashboard_chatwoot_ro;
GRANT SELECT ON TABLE public.messages, public.conversations, public.users
  TO fast_dashboard_chatwoot_ro;
ALTER ROLE fast_dashboard_chatwoot_ro SET default_transaction_read_only = on;
```

Valide que o papel consegue executar `SELECT` nessas três tabelas e não consegue executar `INSERT`, `UPDATE`, `DELETE`, `ALTER` ou `CREATE`.

## 3. Variáveis do servidor

Configure apenas no servidor/secret store, nunca no bundle do navegador:

```text
DATABASE_URL
DATABASE_SSL
CHATWOOT_DATABASE_URL
CHATWOOT_DATABASE_SSL
CHATWOOT_ACCOUNT_ID
CHATWOOT_INBOX_ID
```

`CHATWOOT_ACCOUNT_ID` e `CHATWOOT_INBOX_ID` devem apontar para a inbox Fast Escova. Nenhuma variável usa prefixo `VITE_`.

O dashboard sincroniza ao abrir a página, ao atualizar manualmente e ao aplicar outro período. Não existe scheduler, cron ou polling automático.

## 4. Migrações do banco do dashboard

Execute no banco de `DATABASE_URL`, com um papel autorizado para migração:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-14-add-phone-norm-columns.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-10-12-add-dashboard-analytics.sql
```

Confirme a existência de `dashboard_analytics.chatwoot_messages`, `dashboard_analytics.sync_state` e `dashboard_analytics.business_seconds`. A projeção não deve possuir coluna de conteúdo de mensagem.

## 5. Compatibilidade do Chatwoot

Com a credencial somente leitura configurada:

```bash
bun scripts/verify-chatwoot-schema.mjs
```

O comando deve informar compatibilidade para `messages`, `conversations`, `users` e valores de status. Ele não imprime amostras ou payloads. Não continue com schema incompatível.

## 6. Carga histórica retomável

```bash
bun scripts/backfill-chatwoot.mjs
```

O resultado deve terminar com `status: "current"` e registrar apenas quantidade projetada, quantidade processada e cursor terminal. Se houver interrupção, execute novamente: o cursor composto e os upserts tornam a carga retomável e idempotente.

## 7. Reconciliação

Escolha um período já encerrado e conhecido:

```bash
bun scripts/reconcile-dashboard.mjs --start 2026-09-01 --end 2026-09-30
```

Compare os totais agregados com consultas aprovadas no Chatwoot e no sistema de disparos. Registre a evidência para:

- uma campanha encerrada;
- uma resposta exatamente 48 horas depois do envio;
- uma conversa atendida por mais de uma pessoa;
- uma resposta que atravesse a noite ou o domingo;
- enviadas, entregues, lidas, respondidas e falhas;
- conversas atendidas, mensagens recebidas e respostas humanas.

Não copie conteúdo de mensagem, telefone, token ou URL de conexão para o relatório de reconciliação.

## 8. Deploy e smoke test

1. Publique a imagem somente depois do job `validate` do GitHub Actions concluir.
2. Aplique a nova imagem mantendo as variáveis anteriores e as novas variáveis do Chatwoot.
3. Verifique `GET /api/health`.
4. Abra o dashboard e confirme que o padrão é “Últimos 30 dias”.
5. Confirme funil, campanhas, atendimento geral e desempenho por atendente.
6. Troque para um período personalizado e confirme uma nova atualização sob demanda.
7. Recarregue a página e confirme que ocorre trabalho incremental, sem requisições periódicas em segundo plano.
8. Em uma janela controlada, bloqueie temporariamente a conexão de leitura do Chatwoot. Confirme que os números anteriores continuam visíveis com aviso de dados desatualizados; restaure a conexão imediatamente.
9. Confirme que a interface não mostra conteúdo de mensagens, SQL, credenciais ou termos técnicos internos.

## 9. Rollback

1. Reimplante a imagem registrada antes da mudança.
2. Restaure as variáveis compatíveis com essa imagem.
3. Preserve o schema `dashboard_analytics` e o cursor para diagnóstico; não o apague durante o rollback.
4. Se a migração tiver causado um problema independente da aplicação, restaure o backup em coordenação com o responsável pelo banco. Não faça rollback destrutivo improvisado.
5. Revogue a credencial Chatwoot somente se ela estiver comprometida. Caso contrário, mantenha-a desativada ou preservada para a investigação conforme a política local.
6. Registre causa, cursor terminal, contagens agregadas e horário da última sincronização bem-sucedida, sem dados pessoais.
