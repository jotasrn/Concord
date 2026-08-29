# Concord

Plataforma de comunicacao para gamers: servidores, canais de texto e voz, chamadas de video e
compartilhamento de tela via WebRTC.

> **Status atual: Fase 1 concluida** (monorepo, NestJS, Prisma/PostgreSQL, Redis, Docker, React/Vite).
> Autenticacao, servidores, chat e WebRTC entram nas fases seguintes — veja o [roadmap](#roadmap).

## Stack

| Camada         | Tecnologias                                                        |
| -------------- | ------------------------------------------------------------------ |
| Frontend       | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zustand, Lucide |
| Backend        | NestJS 10, TypeScript, Socket.IO, Passport/JWT, argon2              |
| Banco          | PostgreSQL 16 + Prisma ORM                                          |
| Cache/Presence | Redis 7                                                             |
| Tempo real     | Socket.IO (sinalizacao) + WebRTC (midia)                            |
| NAT traversal  | coturn (STUN/TURN)                                                  |

## Estrutura

```
apps/
  api/        NestJS - REST + WebSocket gateways + Prisma
  web/        React + Vite - SPA
packages/
  types/      Contratos compartilhados (entidades, eventos WS, envelope de API)
  shared/     Utilitarios puros (bitmask de permissoes, constantes)
  ui/         Design system (a partir da Fase 4)
  config/     tsconfig base compartilhado
infrastructure/
  docker/     Dockerfiles + nginx
  turn/       Configuracao do coturn
docs/         ARCHITECTURE, DATABASE, API, WEBSOCKET, WEBRTC, SECURITY, DEPLOY
```

## Como executar

Requisitos: **Node 20+** e **Docker Desktop**.

### 1. Variaveis de ambiente

```bash
cp .env.example .env
```

Gere segredos reais para `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Configurar o TURN

```bash
cp infrastructure/turn/turnserver.conf.example infrastructure/turn/turnserver.conf
```

Troque `CHANGE_ME` pela senha definida em `TURN_PASSWORD`. Detalhes em [docs/WEBRTC.md](docs/WEBRTC.md).

### 3. Subir a infraestrutura

```bash
docker compose up -d
```

Isso sobe **postgres**, **redis** e **coturn**. As aplicacoes rodam localmente com hot reload
(os servicos `api` e `web` do compose ficam no profile `full`, usado apenas para validar a imagem
de producao: `docker compose --profile full up -d --build`).

### 4. Instalar dependencias e migrar o banco

```bash
npm install
```

```bash
npm run prisma:migrate --workspace=apps/api
```

### 5. Rodar em desenvolvimento

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- API: <http://localhost:3333/api>
- Swagger: <http://localhost:3333/api/docs>
- Web: <http://localhost:5173>

A rota `/status` do frontend consulta `GET /api/health` e mostra o estado real de PostgreSQL e Redis.
A API sobe em **modo degradado** se o banco estiver fora, justamente para que essa tela consiga
apontar qual dependencia falhou.

## Scripts

| Comando                                        | Efeito                                  |
| ---------------------------------------------- | --------------------------------------- |
| `npm run build`                                | Compila packages, API e web             |
| `npm run dev:api` / `npm run dev:web`          | Dev server com watch                    |
| `npm run test`                                 | Testes de todos os workspaces           |
| `npm run prisma:migrate --workspace=apps/api`  | Cria/aplica migrations                  |
| `npm run prisma:studio --workspace=apps/api`   | GUI do banco                            |

Os comandos Prisma usam `dotenv-cli` apontando para o `.env` da raiz, mantendo um unico arquivo de
configuracao no monorepo.

## Documentacao

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — decisoes de arquitetura e topologia de midia
- [DATABASE.md](docs/DATABASE.md) — modelo de dados e indices
- [WEBRTC.md](docs/WEBRTC.md) — fluxo de sinalizacao, STUN/TURN
- [WEBSOCKET.md](docs/WEBSOCKET.md) — gateways e eventos
- [SECURITY.md](docs/SECURITY.md) — autenticacao, permissoes e rate limiting
- [API.md](docs/API.md) — superficie REST
- [DEPLOY.md](docs/DEPLOY.md) — producao

## Roadmap

| Fase | Escopo                                        | Status     |
| ---- | --------------------------------------------- | ---------- |
| 1    | Monorepo, NestJS, Prisma, Redis, Docker, React | Concluida  |
| 2    | Autenticacao (registro, login, JWT, perfil)    | Proxima    |
| 3    | Servidores/comunidades                        | Pendente   |
| 4    | Canais e categorias                           | Pendente   |
| 5    | Chat em tempo real                            | Pendente   |
| 6    | Presence                                      | Pendente   |
| 7    | Voz (WebRTC)                                  | Pendente   |
| 8    | Video                                         | Pendente   |
| 9    | Compartilhamento de tela                      | Pendente   |
| 10   | TURN em producao                              | Pendente   |
| 11   | Amigos e DMs                                  | Pendente   |
| 12   | Endurecimento de seguranca                    | Pendente   |
| 13   | Testes                                        | Pendente   |
| 14   | Performance                                   | Pendente   |
| 15   | Deploy                                        | Pendente   |
