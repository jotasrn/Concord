# Seguranca

## Implementado na Fase 1

| Item                        | Onde                                                        |
| --------------------------- | ----------------------------------------------------------- |
| Helmet (security headers)   | `apps/api/src/main.ts`                                      |
| CORS restrito por origem    | `apps/api/src/main.ts` (`API_CORS_ORIGIN`)                  |
| Validacao global de DTO     | `ValidationPipe` com `whitelist` + `forbidNonWhitelisted`   |
| Rate limiting global        | `ThrottlerModule` (120 req/min) + `ThrottlerGuard` global   |
| Erros sem vazamento         | `HttpExceptionFilter`                                       |
| Segredos fora do Git        | `.env` e `turnserver.conf` gitignorados; `.env.example` sem valores reais |

`forbidNonWhitelisted` faz a API **rejeitar** requisicoes com campos nao declarados no DTO em vez
de apenas ignora-los. Isso transforma tentativa de mass assignment em erro explicito.

O `HttpExceptionFilter` so repassa mensagens de `HttpException` (lancadas deliberadamente pelo
codigo). Qualquer outro erro vira `INTERNAL_SERVER_ERROR` com mensagem generica, e o detalhe fica
apenas no log do servidor.

## Planejado por fase

### Fase 2 — Autenticacao

- **argon2** para hash de senha (nao bcrypt): resistente a ataque por GPU/ASIC e vencedor da
  Password Hashing Competition. Custo de memoria configuravel.
- **Access token curto** (15 min) + **refresh token longo** (7 dias).
- Refresh tokens **armazenados como hash** em `RefreshToken.tokenHash`. Vazamento do banco nao
  entrega sessoes ativas.
- **Rotacao de refresh token**: cada uso emite um novo e revoga o anterior. Reuso de um token ja
  revogado indica roubo e derruba toda a familia de tokens do usuario.
- Rate limit especifico em login/registro (`RATE_LIMITS.AUTH_ATTEMPTS_PER_15_MIN`) contra brute
  force, com contador no Redis por IP **e** por conta.

### Fase 3+ — Autorizacao

- `PermissionsGuard` resolvendo o bitmask efetivo do membro (OR dos cargos) contra a permissao
  exigida pelo endpoint.
- `Server.ownerId` sempre tem acesso total, independente de configuracao de cargo.
- **A checagem roda no backend em toda operacao.** O frontend usa as mesmas funcoes apenas para
  esconder controles — nunca como fonte de verdade.

### Fase 5+ — Chat

- Limite de tamanho de mensagem validado no servidor.
- Rate limit por socket em `message:create`.
- Conteudo persistido cru e **escapado na renderizacao** (React escapa por padrao; nao usar
  `dangerouslySetInnerHTML` em conteudo de usuario).
- Mencoes resolvidas no servidor, sem confiar em IDs enviados pelo cliente.

### Fase 7+ — Voz e sinalizacao

- Handshake do WebSocket exige JWT valido.
- `fromUserId` do payload de sinalizacao e **ignorado** — vale a identidade autenticada do socket.
- Servidor valida que origem e destino estao no mesmo canal de voz antes de rotear SDP/ICE.
- Credenciais TURN temporarias (HMAC com validade curta) em vez de senha estatica.

## Politica de segredos

- Nenhum segredo real entra no Git. `.env.example` contem apenas placeholders.
- `infrastructure/turn/turnserver.conf` e gitignorado; versionado apenas o `.example`.
- Logs nunca registram senha, token, JWT ou payload de autenticacao.
- Em producao, os segredos vem do gerenciador de secrets do provedor, nao de arquivo `.env`.

## Nao confiar no frontend

Regra transversal: qualquer dado vindo do cliente — body, query, payload de socket, `fromUserId`
de sinalizacao — e entrada nao confiavel. Validacao e autorizacao acontecem no servidor, em toda
requisicao, mesmo quando a UI ja escondeu o controle correspondente.
