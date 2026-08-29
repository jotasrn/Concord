# WebSocket

> **Estado:** contratos de eventos definidos em `packages/types`. Os gateways entram nas Fases 5–7.

Transporte: Socket.IO sobre o mesmo processo HTTP da API.

## Gateways

Um gateway por dominio, nunca um unico gateway monolitico:

| Gateway           | Namespace   | Responsabilidade                                  |
| ----------------- | ----------- | ------------------------------------------------- |
| `PresenceGateway` | `/presence` | Online/ausente/DND, entrada e saida de usuarios    |
| `MessageGateway`  | `/chat`     | Mensagens, reacoes, indicador de digitacao         |
| `ServerGateway`   | `/servers`  | Mudancas em canais, categorias e membros           |
| `VoiceGateway`    | `/voice`    | Entrada/saida de canal de voz, estado de midia     |
| `CallGateway`     | `/voice`    | Sinalizacao WebRTC (offer/answer/ICE)              |

## Rooms

O particionamento por room evita broadcast global:

```
server:<serverId>     todos os membros conectados do servidor
channel:<channelId>   quem esta com o canal de texto aberto
voice:<channelId>     quem esta conectado no canal de voz
user:<userId>         todas as sessoes do proprio usuario (multi-dispositivo)
```

## Eventos

Definidos em [`packages/types/src/events.ts`](../packages/types/src/events.ts) e importados pelo
cliente e pelo servidor.

### Mensagens (`MessageEvents`)

| Evento                    | Direcao          | Payload                        |
| ------------------------- | ---------------- | ------------------------------ |
| `message:create`          | cliente ↔ servidor | `{ channelId, content, replyToId? }` |
| `message:update`          | cliente ↔ servidor | `{ messageId, content }`       |
| `message:delete`          | cliente ↔ servidor | `{ messageId }`                |
| `message:reaction:add`    | cliente ↔ servidor | `{ messageId, emoji }`         |
| `message:reaction:remove` | cliente ↔ servidor | `{ messageId, emoji }`         |
| `message:typing`          | cliente → servidor | `TypingPayload`                |
| `message:read`            | cliente → servidor | `{ channelId, messageId }`     |

### Presence (`PresenceEvents`)

| Evento               | Direcao            | Payload                    |
| -------------------- | ------------------ | -------------------------- |
| `presence:subscribe` | cliente → servidor | `{ userIds: string[] }`    |
| `presence:update`    | servidor → cliente | `{ userId, status }`       |

### Voz (`VoiceEvents`)

| Evento               | Direcao            | Payload             |
| -------------------- | ------------------ | ------------------- |
| `voice:join`         | cliente → servidor | `{ channelId }`     |
| `voice:leave`        | cliente → servidor | `{ channelId }`     |
| `voice:state:update` | cliente ↔ servidor | `VoiceStatePayload` |
| `voice:participants` | servidor → cliente | lista de sessoes    |

### Sinalizacao WebRTC (`SignalingEvents`)

| Evento              | Direcao            | Payload                   |
| ------------------- | ------------------ | ------------------------- |
| `rtc:offer`         | cliente ↔ servidor | `RtcOfferPayload`         |
| `rtc:answer`        | cliente ↔ servidor | `RtcAnswerPayload`        |
| `rtc:ice-candidate` | cliente ↔ servidor | `RtcIceCandidatePayload`  |
| `rtc:peer-joined`   | servidor → cliente | `{ userId, channelId }`   |
| `rtc:peer-left`     | servidor → cliente | `{ userId, channelId }`   |

Eventos de sinalizacao sao roteados 1:1 para `targetUserId`. O servidor valida que **origem e
destino estao no mesmo canal de voz** antes de encaminhar — sem isso, qualquer cliente
autenticado poderia injetar SDP em uma call de terceiros.

## Autenticacao

O handshake carrega o access token:

```ts
io(WS_URL, { auth: { token: accessToken } });
```

Um guard de WebSocket valida o JWT na conexao e anexa o usuario ao socket. Conexao sem token
valido e recusada antes de entrar em qualquer room.

## Regras de seguranca

1. **Toda permissao e verificada no servidor a cada evento**, nunca apenas na entrada da room.
   Um membro pode perder acesso durante a sessao.
2. **Rate limiting por socket** em `message:create` e `message:typing`, com contadores no Redis.
3. **Tamanho de payload limitado** (`MESSAGE_MAX_LENGTH` em `packages/shared`), validado no
   servidor antes de qualquer persistencia.
4. **Sinalizacao nao e confiavel por origem**: o `fromUserId` do payload e ignorado; o servidor
   usa a identidade autenticada do socket.

## Escala horizontal

Com mais de uma instancia da API, os sockets de um mesmo canal caem em processos diferentes.
O `@socket.io/redis-adapter` propaga os broadcasts entre instancias usando o Redis ja provisionado.
Isso e configuracao, nao reescrita — os gateways nao mudam.
