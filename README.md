# Fast Escova Dashboard

Dashboard de resultados de campanhas e atendimento humano da Fast Escova. O servidor combina o schema operacional `disparos` com uma projeção mínima, sem conteúdo de mensagens, do PostgreSQL do Chatwoot.

O projeto usa TanStack Start, React, TypeScript, Tailwind CSS, Recharts e PostgreSQL. Todas as credenciais e consultas permanecem no servidor.

## O que o painel mostra

- Funil de campanhas: enviadas, entregues, lidas, pessoas que responderam e falhas confirmadas.
- Resposta de campanha atribuída ao disparo elegível mais recente dentro de 48 horas.
- Taxas de entrega, leitura e resposta, custo estimado de US$ 0,04 por envio e custo por resposta.
- Conversas atendidas, mensagens recebidas, respostas humanas e tempos de resposta da equipe.
- Conversas, mensagens enviadas e tempo médio de resposta por atendente real.
- Pendências e resultados incertos em uma área operacional separada das falhas.

Os tempos consideram segunda a sábado, das 08:00 às 20:00, no fuso `America/Araguaina`. Templates, automações, notas privadas e eventos de sistema não entram nas métricas humanas.

## Atualização dos dados

Cada abertura, atualização manual ou mudança de período tenta sincronizar incrementalmente o Chatwoot antes de calcular o relatório. Requisições simultâneas compartilham apenas a sincronização em andamento.

Não existe scheduler, cron ou polling automático. Se o Chatwoot estiver temporariamente indisponível após uma sincronização bem-sucedida, o painel preserva os últimos dados e mostra um aviso de desatualização.

## Configuração

Crie `.env` a partir de `.env.example`:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco_dashboard
DATABASE_SSL=disable

CHATWOOT_DATABASE_URL=postgresql://usuario_leitura:senha@host:5432/chatwoot
CHATWOOT_DATABASE_SSL=disable
CHATWOOT_ACCOUNT_ID=2
CHATWOOT_INBOX_ID=1

TEST_DATABASE_URL=postgresql://postgres:senha@localhost:5432/fast_dashboard_test
```

- `DATABASE_URL`: banco que contém `disparos` e receberá `dashboard_analytics`.
- `DATABASE_SSL`: use `disable` somente quando a rede confiável não utilizar TLS.
- `CHATWOOT_DATABASE_URL`: conexão exclusiva e somente leitura com o Chatwoot.
- `CHATWOOT_DATABASE_SSL`: configuração TLS da conexão do Chatwoot.
- `CHATWOOT_ACCOUNT_ID` e `CHATWOOT_INBOX_ID`: escopo obrigatório da Fast Escova.
- `TEST_DATABASE_URL`: banco isolado, usado apenas pelos testes de integração.

Nenhuma dessas variáveis pode usar o prefixo `VITE_`.

## Migrações

Antes da primeira execução:

```bash
psql "$DATABASE_URL" -f sql/2026-08-14-add-phone-norm-columns.sql
psql "$DATABASE_URL" -f sql/2026-10-12-add-dashboard-analytics.sql
```

A primeira migração mantém o fallback de telefone para registros históricos. A segunda cria a projeção analítica, o cursor de sincronização e a função de minutos úteis.

## Desenvolvimento e validação

Requisitos: Bun 1.3 ou superior e PostgreSQL.

```bash
bun install --frozen-lockfile
bun run dev
```

Validação completa:

```bash
bun run test
bun run lint
bun run build
git diff --check
```

O endpoint `GET /api/health` verifica a saúde do container.

## Preparação da produção

Com as credenciais aprovadas no ambiente:

```bash
bun scripts/verify-chatwoot-schema.mjs
bun scripts/backfill-chatwoot.mjs
bun scripts/reconcile-dashboard.mjs --start 2026-09-01 --end 2026-09-30
```

Esses comandos exibem somente compatibilidade, contagens agregadas e cursor. Não imprimem conteúdo de mensagens, telefones ou credenciais. O processo completo e o rollback estão em [docs/runbooks/chatwoot-dashboard-rollout.md](docs/runbooks/chatwoot-dashboard-rollout.md).

## Imagem Docker e CI

O GitHub Actions executa testes unitários e de integração com PostgreSQL, lint e build antes de publicar a imagem da branch `main`:

```text
ghcr.io/felip2ee/fast-escova-dashboard:latest
```

O arquivo local `portainer-stack.yml` fica fora do Git. A stack precisa fornecer todas as variáveis de produção acima e pode manter `DASHBOARD_DOMAIN`, `TRAEFIK_ENTRYPOINT` e `TRAEFIK_CERTRESOLVER` conforme o ambiente atual.

## Segurança

- Use um papel somente leitura para `messages`, `conversations` e `users` no Chatwoot.
- Não versione `.env`, stacks com credenciais ou relatórios operacionais.
- A projeção não persiste o conteúdo das mensagens.
- Erros enviados ao navegador e estados persistidos não incluem SQL, URLs de conexão ou tokens.
- A escrita do dashboard fica restrita ao banco operacional e ao schema analítico.
