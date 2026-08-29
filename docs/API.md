# API REST

Base: `http://localhost:3333/api`
Swagger: <http://localhost:3333/api/docs>

## Envelope de resposta

Sucesso (`TransformInterceptor`):

```json
{ "success": true, "data": { } }
```

Erro (`HttpExceptionFilter`):

```json
{ "success": false, "message": "Mensagem de erro", "code": "ERROR_CODE" }
```

O cliente sempre discrimina pelo campo `success`.

## Endpoints disponiveis (Fase 1)

### `GET /api/health`

Estado da API e das dependencias. Nao exige autenticacao.

```json
{
  "success": true,
  "data": { "status": "ok", "database": true, "redis": true, "uptime": 128.4 }
}
```

`status` e `"degraded"` quando PostgreSQL ou Redis estao inacessiveis. A API responde 200 mesmo
degradada — e justamente essa resposta que identifica qual dependencia caiu.

## Superficie planejada

Nenhum destes endpoints existe ainda. Sao o contrato alvo das proximas fases.

### Fase 2 — `/api/auth`, `/api/users`

| Metodo | Rota                    | Descricao                        |
| ------ | ----------------------- | -------------------------------- |
| POST   | `/auth/register`        | Cria conta                       |
| POST   | `/auth/login`           | Emite access + refresh token     |
| POST   | `/auth/refresh`         | Rotaciona o refresh token        |
| POST   | `/auth/logout`          | Revoga o refresh token           |
| POST   | `/auth/forgot-password` | Inicia recuperacao de senha      |
| POST   | `/auth/reset-password`  | Redefine a senha                 |
| GET    | `/users/me`             | Perfil do usuario autenticado    |
| PATCH  | `/users/me`             | Atualiza perfil e status         |
| GET    | `/users/:id`            | Perfil publico                   |

### Fase 3 — `/api/servers`

| Metodo | Rota                       | Permissao        |
| ------ | -------------------------- | ---------------- |
| GET    | `/servers`                 | —                |
| POST   | `/servers`                 | —                |
| GET    | `/servers/:id`             | `VIEW_CHANNEL`   |
| PATCH  | `/servers/:id`             | `MANAGE_SERVER`  |
| DELETE | `/servers/:id`             | dono             |
| GET    | `/servers/:id/members`     | `VIEW_CHANNEL`   |
| DELETE | `/servers/:id/members/:uid`| `KICK_MEMBERS`   |
| DELETE | `/servers/:id/leave`       | membro           |

### Fase 3 — `/api/invites`

| Metodo | Rota                    | Permissao       |
| ------ | ----------------------- | --------------- |
| POST   | `/servers/:id/invites`  | `MANAGE_SERVER` |
| GET    | `/invites/:code`        | —               |
| POST   | `/invites/:code/accept` | —               |
| DELETE | `/invites/:code`        | `MANAGE_SERVER` |

### Fase 4 — `/api/channels`

| Metodo | Rota                     | Permissao          |
| ------ | ------------------------ | ------------------ |
| POST   | `/servers/:id/channels`  | `MANAGE_CHANNELS`  |
| PATCH  | `/channels/:id`          | `MANAGE_CHANNELS`  |
| DELETE | `/channels/:id`          | `MANAGE_CHANNELS`  |
| PATCH  | `/channels/:id/position` | `MANAGE_CHANNELS`  |

### Fase 5 — `/api/channels/:id/messages`

| Metodo | Rota                          | Permissao       |
| ------ | ----------------------------- | --------------- |
| GET    | `/channels/:id/messages`      | `VIEW_CHANNEL`  |
| POST   | `/channels/:id/messages`      | `SEND_MESSAGES` |
| PATCH  | `/messages/:id`               | autor           |
| DELETE | `/messages/:id`               | autor ou `MANAGE_MEMBERS` |

O historico usa **paginacao por keyset** (`?before=<messageId>&limit=50`), nao offset: com
insercao constante, `OFFSET` desloca a janela e duplica ou pula mensagens. O indice
`(channelId, createdAt)` sustenta essa query.

### Fase 11 — `/api/friends`

| Metodo | Rota                  | Descricao              |
| ------ | --------------------- | ---------------------- |
| GET    | `/friends`            | Lista de amigos        |
| POST   | `/friends/requests`   | Envia solicitacao      |
| PATCH  | `/friends/requests/:id` | Aceita ou recusa     |
| DELETE | `/friends/:id`        | Remove amizade         |
| POST   | `/users/:id/block`    | Bloqueia usuario       |

## Autenticacao

A partir da Fase 2, rotas protegidas exigem:

```
Authorization: Bearer <access_token>
```

Access token expira em 15 minutos; o cliente rotaciona via `POST /auth/refresh`.
