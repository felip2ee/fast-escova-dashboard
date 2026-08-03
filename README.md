## Execução local

1. Copie `.env.example` para `.env` e informe `DATABASE_URL`.
2. Execute `bun install`.
3. Execute `bun run dev`.

O Postgres é acessado somente pela camada servidor em `/api/dashboard`; a senha não é enviada ao navegador. As métricas consideram segunda a sábado, das 08:00 às 20:00, no fuso `America/Araguaina`. Conversas são atribuídas ao disparo quando a primeira resposta ocorre em até 24 horas. CTR = conversas geradas / mensagens entregues.

## Portainer / Swarm

Use `portainer-stack.yml` no Web Editor. Cadastre `DATABASE_URL` como variável da stack. A imagem pública é `ghcr.io/felip2ee/fast-escova-dashboard:latest` e o domínio padrão é `fast.agencianovabr.com`.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
