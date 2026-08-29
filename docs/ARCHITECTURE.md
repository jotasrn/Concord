# Arquitetura

## Visao geral

```
                    ┌─────────────────────────────┐
                    │   Browser (React + Vite)    │
                    │  ┌───────────────────────┐  │
                    │  │ WebRTCService         │  │
                    │  │ (PeerConnections)     │  │
                    │  └───────────┬───────────┘  │
                    └──────┬───────┼──────────────┘
                    REST/WS│       │ midia (SRTP)
                           │       │
        ┌──────────────────▼───┐   │   ┌──────────────┐
        │   NestJS API         │   └──▶│    coturn    │
        │  ┌────────────────┐  │       │  STUN/TURN   │
        │  │ REST modules   │  │       └──────────────┘
        │  │ WS gateways    │  │
        │  └───────┬────────┘  │
        └──────┬───┴───────────┘
               │           │
        ┌──────▼─────┐ ┌───▼──────┐
        │ PostgreSQL │ │  Redis   │
        │  (Prisma)  │ │ presence │
        └────────────┘ └──────────┘
```

Ponto central: **a midia nunca passa pela API**. O NestJS transporta apenas sinalizacao
(SDP e ICE candidates). Audio, video e tela trafegam direto entre os navegadores, com o coturn
atuando como relay apenas quando a conexao direta falha.

## Decisoes tecnicas

### 1. Monorepo com npm workspaces (nao Turborepo/Nx)

O projeto tem dois apps e quatro packages. Workspaces nativos resolvem o link entre eles sem
adicionar uma camada de build orchestration que so se paga em repositorios grandes. Se o tempo de
build virar problema, Turborepo entra depois sem alterar a estrutura de pastas.

### 2. Contratos compartilhados em `packages/types`

Nomes de eventos WebSocket e formatos de payload sao a maior fonte de bugs silenciosos em apps
realtime: um typo em `'message:create'` no cliente nao quebra o build, so cria um canal morto.
Por isso os nomes de evento vivem em objetos `as const` compartilhados entre web e API.

`packages/types` **nao** usa a lib `dom` do TypeScript porque tambem e compilado no lado Node.
Por isso os tipos WebRTC (`RtcSessionDescription`, `RtcIceCandidate`) sao declarados localmente
espelhando as interfaces do DOM, em vez de importar `RTCSessionDescriptionInit`.

### 3. Permissoes como bitmask BigInt

`Role.permissions` e um `BIGINT` no Postgres, com as flags de `Permission` combinadas por OR.
Verificar permissao vira uma operacao de bit em vez de um join por linha de permissao, e a
checagem `ADMINISTRATOR` curto-circuita todas as outras (`packages/shared/src/permissions.ts`).

A validacao roda **sempre no backend**. O frontend usa as mesmas funcoes apenas para esconder
controles — nunca como fonte de verdade.

### 4. WebRTC: malha (mesh) no MVP, SFU depois

Este e o principal trade-off do projeto e o maior risco tecnico.

**Malha (P2P full mesh)** — cada participante abre uma `RTCPeerConnection` com cada outro.
Para N participantes cada cliente mantem N-1 conexoes e envia seu video N-1 vezes.

| Participantes | Uploads por cliente | Viabilidade                       |
| ------------- | ------------------- | --------------------------------- |
| 2–4           | 1–3                 | Confortavel                       |
| 5–6           | 4–5                 | Limite pratico com video ligado   |
| 8+            | 7+                  | Inviavel sem SFU                  |

O MVP usa malha porque: o caso de uso alvo e um squad de amigos (2–6 pessoas), nao precisa de
servidor de midia, e a latencia e a menor possivel. Voz pura escala melhor que video — audio
Opus custa ~40 kbps contra ~1–2 Mbps de video.

Quando o requisito passar de ~6 participantes com video, a saida e um **SFU** (mediasoup ou
LiveKit): cada cliente envia um unico stream ao servidor, que redistribui. A `WebRTCService`
isola a criacao de PeerConnections exatamente para que essa troca nao vaze para os componentes
React.

### 5. Redis como camada de presence e escala horizontal

Presence nao vai para o Postgres: e estado efemero com escrita altissima. Fica em Redis com TTL.
Quando a API rodar em mais de uma instancia, o `@socket.io/redis-adapter` propaga eventos entre
elas — por isso o Redis ja e uma dependencia de primeira classe desde a Fase 1, e nao um
"otimizacao futura".

### 6. Envelope de resposta uniforme

Todo endpoint REST responde `{ success: true, data }` (via `TransformInterceptor`) ou
`{ success: false, message, code }` (via `HttpExceptionFilter`). O cliente sempre discrimina pelo
mesmo campo, e erros internos nunca vazam stack trace — sao logados no servidor e substituidos
por uma mensagem generica.

### 7. Boot em modo degradado

`PrismaService.onModuleInit` captura falha de conexao inicial e deixa a API subir mesmo assim.
Sem isso, o container morre em loop quando o Postgres demora a ficar pronto e o operador nao tem
como consultar `/api/health` para descobrir *qual* dependencia falhou. Queries continuam falhando
normalmente enquanto o banco estiver fora — nao ha fallback silencioso.

## Camadas do backend

```
src/
├── modules/          Um modulo por dominio (auth, users, servers, channels, ...)
│   └── <dominio>/
│       ├── dto/              Validacao de entrada (class-validator)
│       ├── *.controller.ts   REST
│       ├── *.gateway.ts      WebSocket
│       └── *.service.ts      Regra de negocio
├── common/           Prisma, Redis, filtros, interceptors
├── guards/           JwtAuthGuard, PermissionsGuard
└── config/           Leitura tipada de env
```

Regra: gateways e controllers nao contem regra de negocio, apenas orquestram services. Isso
permite que a mesma operacao (ex: criar mensagem) seja exposta por REST e por WebSocket sem
duplicacao.

## Camadas do frontend

```
src/
├── features/     Fatias verticais (auth, chat, servers, voice, video, friends)
├── services/     Clientes de API e do socket
├── stores/       Zustand - estado global (sessao, presence, estado da call)
├── components/   Design system e componentes de UI
└── lib/          Instancias de axios/socket, WebRTCService
```

A logica de WebRTC fica em `services`/`lib`, nunca dentro de componentes: um `useEffect` que cria
PeerConnections e reexecutado em cada render do StrictMode e vaza conexoes.

## Observabilidade (preparado, nao implementado)

O `HttpExceptionFilter` centraliza o tratamento de erro e e o ponto de entrada natural para o
Sentry. As metricas de Prometheus entram como um `MetricsModule` com um interceptor global. Nada
na arquitetura atual impede isso — mas nada disso esta implementado ainda.
