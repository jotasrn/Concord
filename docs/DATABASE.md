# Banco de dados

PostgreSQL 16 com Prisma ORM. Schema: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## Diagrama de relacionamentos

```
User ──< ServerMember >── Server ──< Channel ──< Message ──< MessageReaction
 │                          │           │                        │
 │                          │           └──< VoiceSession         │
 │                          ├──< Role (M:N com ServerMember)      │
 │                          ├──< Category ──< Channel             │
 │                          └──< Invite                           │
 ├──< RefreshToken                                                │
 ├──< Friendship (auto-relacao requester/addressee)               │
 ├──< Block (auto-relacao blocker/blocked)                        │
 └──< DirectMessage (auto-relacao sender/recipient) ──────────────┘
```

## Modelos

| Modelo            | Papel                                                        |
| ----------------- | ------------------------------------------------------------ |
| `User`            | Conta, perfil e status de presence                           |
| `RefreshToken`    | Refresh tokens com hash, expiracao e revogacao               |
| `Friendship`      | Solicitacoes e amizades (PENDING/ACCEPTED/DECLINED)          |
| `Block`           | Bloqueios entre usuarios                                     |
| `Server`          | Comunidade                                                   |
| `Role`            | Cargo com bitmask de permissoes                              |
| `ServerMember`    | Vinculo usuario↔servidor, com apelido e cargos               |
| `Category`        | Agrupamento de canais                                        |
| `Channel`         | Canal de texto ou voz                                        |
| `Message`         | Mensagem, com auto-relacao para respostas                    |
| `MessageReaction` | Reacao por emoji                                             |
| `Invite`          | Convite com codigo, limite de usos e expiracao               |
| `DirectMessage`   | Mensagem privada                                             |
| `VoiceSession`    | Sessao de voz ativa/historica com flags de midia             |

## Decisoes de modelagem

### Permissoes em BIGINT

`Role.permissions` guarda um bitmask em vez de uma tabela `Permission` com uma linha por flag.
Checar acesso vira uma operacao de bit, sem join. O custo e legibilidade em queries cruas — o que
se resolve pelos helpers de `packages/shared`.

### Cargos M:N com membros

`ServerMember.roles` e uma relacao muitos-para-muitos (`MemberRoles`). As permissoes efetivas de
um membro sao o OR dos bitmasks de todos os seus cargos. O `Server.ownerId` sempre vence — o dono
nao pode perder acesso por configuracao de cargo.

### `Message.replyTo` com `onDelete: SetNull`

Apagar uma mensagem respondida nao pode apagar as respostas em cascata. O vinculo vira `NULL` e a
UI mostra "mensagem original removida".

### `Channel.categoryId` com `onDelete: SetNull`

Apagar uma categoria nao apaga canais — eles voltam para a raiz do servidor.

### Presence fora do banco

`User.status` guarda a **preferencia** do usuario (ex: "nao perturbe"), que e persistente.
O estado de conexao (online/offline agora) vive no Redis, com TTL. Sao coisas diferentes: um
usuario com status `DND` continua `DND` depois de desconectar.

## Indices

| Tabela            | Indice                            | Motivo                                           |
| ----------------- | --------------------------------- | ------------------------------------------------ |
| `User`            | `username`, `email` (unique)      | Login e busca de usuarios                        |
| `Message`         | `(channelId, createdAt)`          | Paginacao por keyset no historico do canal       |
| `Message`         | `authorId`                        | Buscar mensagens de um autor                     |
| `ServerMember`    | `(serverId, userId)` unique       | Impede membro duplicado; acelera checagem de acesso |
| `Friendship`      | `(requesterId, addresseeId)` unique | Impede solicitacao duplicada                   |
| `Block`           | `(blockerId, blockedId)` unique   | Impede bloqueio duplicado                        |
| `MessageReaction` | `(messageId, userId, emoji)` unique | Uma reacao por emoji por usuario               |
| `Invite`          | `code` unique                     | Resolucao de convite por codigo                  |
| `DirectMessage`   | `(senderId, recipientId, createdAt)` | Historico de conversa privada                 |

O indice composto `(channelId, createdAt)` em `Message` e o mais critico: e o que sustenta a
paginacao do chat, a query mais frequente da aplicacao.

## Migrations

A migration inicial esta em `apps/api/prisma/migrations/20260829000000_init/`.

Aplicar em desenvolvimento:

```bash
npm run prisma:migrate --workspace=apps/api
```

Aplicar em producao (sem prompts, sem geracao de nova migration):

```bash
npm run prisma:deploy --workspace=apps/api
```

Os scripts carregam o `.env` da raiz via `dotenv-cli`, entao nao existe um segundo arquivo de
ambiente dentro de `apps/api`.
