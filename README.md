# Fast Escova Dashboard

Dashboard operacional para acompanhar campanhas de WhatsApp da Fast Escova diretamente a partir do PostgreSQL.

O projeto utiliza TanStack Start, React, TypeScript, Tailwind CSS e Recharts. A consulta ao banco acontece exclusivamente no servidor; a credencial do PostgreSQL não é exposta ao navegador.

## Indicadores

- Mensagens disparadas, entregues e lidas.
- Conversas geradas por campanha.
- CTR por campanha.
- Tempo médio de primeira resposta.
- Tempo médio de resposta durante as conversas.
- Evolução diária de disparos e mensagens recebidas.
- Funil de entrega e desempenho detalhado por campanha.

## Regras das métricas

- Horário comercial das métricas de conversa e tempo: segunda a sábado, das 08:00 às 20:00.
- Disparadas: tentativas processadas, incluindo falhas; entregues e lidas consideram todo o processamento da campanha, mesmo quando a fila termina após as 20:00.
- Custo estimado: US$ 0,04 por mensagem disparada.
- Fuso horário: `America/Araguaina`.
- Oportunidade gerada: primeira mensagem recebida do mesmo número, na mesma conta WABA,
  atribuída ao disparo mais recente ocorrido nas 48 horas anteriores.
- CTR: conversas geradas divididas pelas mensagens entregues.
- Primeira resposta: intervalo entre o disparo e a primeira resposta atribuída.
- Resposta média: intervalo entre uma mensagem recebida e a próxima mensagem de saída na mesma conversa.

## Configuração

Crie um arquivo `.env` com base em `.env.example`:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
DATABASE_SSL=disable
```

Esta instalação usa conexão PostgreSQL sem TLS, portanto mantenha `DATABASE_SSL=disable`.

Antes de rodar o dashboard pela primeira vez em um banco (incluindo bancos novos, staging ou restaurados de backup), aplique a migração que cria as colunas normalizadas de telefone usadas pelas consultas de campanhas e disparos por dia:

```bash
psql "$DATABASE_URL" -f sql/2026-08-14-add-phone-norm-columns.sql
```

## Desenvolvimento local

Requisitos:

- Bun 1.3 ou superior.
- PostgreSQL acessível pela máquina local.

```bash
bun install
bun run dev
```

O servidor local estará disponível no endereço exibido pelo Vite.

## Validação

```bash
bun run lint
bun run build
```

O endpoint `GET /api/health` pode ser utilizado para verificar a saúde do container.

## Imagem Docker

A imagem é construída automaticamente pelo GitHub Actions após atualizações na branch `main`:

```text
ghcr.io/felip2ee/fast-escova-dashboard:latest
```

O repositório é privado, mas a imagem do container pode ser utilizada publicamente pelo Portainer sem autenticação no GitHub Container Registry.

## Portainer, Docker Swarm e Traefik

O arquivo local `portainer-stack.yml` está ignorado pelo Git e deve ser colado no Web Editor do Portainer.

Variável obrigatória da stack:

```text
DATABASE_URL
```

Variáveis opcionais:

```text
DATABASE_SSL=disable
DASHBOARD_DOMAIN=fast.agencianovabr.com
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencryptresolver
```

A stack espera que a rede overlay externa `NovaNet` e o Traefik já existam no Swarm.

## Segurança

- Nunca use o prefixo `VITE_` na variável `DATABASE_URL`.
- Não adicione `.env` ou a stack com credenciais ao Git.
- Restrinja o usuário do PostgreSQL às permissões de leitura necessárias para o dashboard.
- O acesso HTTP é redirecionado para HTTPS pelo Traefik.

## Estrutura principal

```text
src/lib/dashboard-db.ts       Consultas e agregações do PostgreSQL
src/routes/index.tsx          Interface principal
src/server.ts                 API e health check
Dockerfile                    Build multi-stage para produção
.github/workflows/            Publicação automatizada da imagem
portainer-stack.yml           Stack local ignorada pelo Git
```
