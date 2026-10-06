# Arquitetura

Concord e um app de comunicacao **P2P local-first**: nao existe servidor. Cada
pessoa instala um executavel, cria a conta na propria maquina e replica os
dados dos outros. Quem volta de offline puxa dos peers o que perdeu.

## Os processos

```
┌──────────────────────────────────────────────────────────┐
│  Electron: processo PRINCIPAL (Node)                      │
│  Onde vive tudo o que e privilegiado                      │
│                                                           │
│   apps/desktop/src/main/  ──usa──▶  packages/core/        │
│                                     identidade, log,      │
│                                     SQLite, rede P2P      │
└───────────────────────────┬──────────────────────────────┘
                            │ IPC (unica ponte, valida tudo)
┌───────────────────────────┴──────────────────────────────┐
│  Electron: processo RENDERER (Chromium, sandbox, sem Node)│
│  apps/web/  ── React, WebRTC, captura de audio e tela     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Janela do OVERLAY (transparente, sobre jogos)            │
│  apps/web/overlay.html + src/overlay.ts                   │
└──────────────────────────────────────────────────────────┘
```

O renderer **nao tem acesso ao Node**. Tudo que toca disco, rede ou sistema
passa pelo IPC, que valida a entrada no processo principal.

### Modo navegador (opcional)

A mesma interface roda num navegador comum. No lugar do IPC, ela fala por
WebSocket com a ponte `apps/server`, que roda o mesmo `packages/core` num
servidor. O codigo React nao sabe em qual dos dois modos esta: `lib/webAdapter.ts`
instala um `window.concord` com a mesma forma que o preload do Electron expoe.

```
navegador (apps/web) ──WebSocket──▶ apps/server ──usa──▶ packages/core ──▶ rede P2P
```

Cada navegador se identifica com um token aleatorio guardado no proprio
navegador; a ponte mantem uma pasta e no maximo uma sessao por token. Detalhes
em [DEPLOY_WEB.md](DEPLOY_WEB.md) e na secao da ponte em [SECURITY.md](SECURITY.md).

## Regra central: operacao vs. efemero

Duas categorias de dado, com destinos opostos:

| | Vai para o log assinado | Vive so na conexao |
|---|---|---|
| **O que** | mensagens, canais, membros, perfil | status, quem esta em call, sinalizacao WebRTC |
| **Por que** | precisa sobreviver e replicar | registrar isso encheria o log de ruido para sempre |

**Estado que nao e operacao nao existe** — nao replica e some quando a projecao
e reconstruida.

---

## `packages/core/` — o nucleo

O coracao do app. Nao depende de Electron nem de React; roda no processo
principal do Electron e na ponte web.

### `identity/`
| Arquivo | Para que |
|---|---|
| `keypair.ts` | Ed25519 pelo crypto nativo do Node: assinar e verificar. Gera o `#a3f9` do seu nome |
| `keystore.ts` | Frase de recuperacao (12 palavras) e keystore cifrado com scrypt + AES-256-GCM |
| `identity.test.ts` | Recuperar a conta em outra maquina so com a frase, senha errada, frase invalida |

### `crypto/`
| Arquivo | Para que |
|---|---|
| `serverKey.ts` | Chave por servidor, topico da DHT, cifra das operacoes, codigo de convite, topico pessoal (caixa de entrada) |
| `vault.ts` | Cifra o que vai para o disco. A chave sai da sua identidade e so existe depois do desbloqueio |
| `*.test.ts` | Verificam que o `.db` em disco nao contem mensagem legivel |

### `ops/` — o log replicado
| Arquivo | Para que |
|---|---|
| `types.ts` | As operacoes possiveis e o formato de cada payload |
| `canonical.ts` | Serializacao com chaves ordenadas. Sem isso a mesma operacao geraria assinaturas diferentes em cada maquina |
| `sign.ts` | Assina, verifica e define a **ordem total** (lamport, autor, seq) que faz todos convergirem |
| `selfCert.ts` | Ids autocertificados (`sha256(autor + nonce)`) para servidor e canal: ninguem forja o id de algo que nao criou |
| `validate.ts` | Formato e limites do que vem da rede. Substitui os casts, que nao verificam nada em runtime |
| `reducer.ts` | Aplica as operacoes ao SQLite conferindo permissao a cada uma |
| `ops.test.ts` | Convergencia de dois peers com ordens diferentes |
| `moderation.test.ts` | Cargos, silenciar e expulsar |
| `hostile.test.ts` | Peer mal-intencionado: payload nulo, tipo errado, mensagem gigante |
| `attacks.test.ts` | Regressao das falhas da revisao externa (ver [SECURITY.md](SECURITY.md)) |

### `db/`
| Arquivo | Para que |
|---|---|
| `schema.ts` | Tabelas. Separa o **log** (fonte da verdade) da **projecao** (cache da interface) |
| `database.ts` | Abertura, migracao de colunas e acesso ao log |

### `p2p/`
| Arquivo | Para que |
|---|---|
| `protocol.ts` | Mensagens trocadas entre peers, enquadramento por linha e `parseVoiceSignal` (valida sinal de voz vindo da interface antes de ir para a rede) |
| `node.ts` | Descoberta pela DHT, prova de identidade, sincronizacao, presenca e caixa de entrada |
| `hyperswarm.d.ts` | Tipos da lib, que nao publica os proprios |

### Raiz
| Arquivo | Para que |
|---|---|
| `store.ts` | **A unica porta de entrada.** A interface nunca fala com SQLite ou rede direto |
| `social.ts` | Amizades e convites pendentes — ficam fora do log porque nao pertencem a servidor nenhum |
| `roles.ts` | Presets de cargo e lista de permissoes (bitmask) |

---

## `apps/desktop/` — o processo principal

### `src/main/`
| Arquivo | Para que |
|---|---|
| `index.ts` | Cria a janela (sandbox, `contextIsolation`), aplica limites de recurso, bloqueia DevTools e navegacao externa |
| `diagnostics.ts` | **Carregado primeiro.** Sem ele, uma falha de import vira uma caixa "Error" sem rastro |
| `session.ts` | Estado vivo: identidade destrancada, banco e no P2P |
| `ipc.ts` | Todos os canais entre interface e nucleo, num envelope `{ ok, data }`. Valida a entrada, inclusive sinais de voz |
| `settings.ts` | Preferencias, limite de memoria e afinidade de CPU |
| `background.ts` | Bandeja, esconder ao fechar e bloqueio de suspensao durante chamadas |
| `overlay.ts` | Janela transparente com as bolinhas de quem esta falando |
| `updater.ts` | Auto-update pelo GitHub Releases; nunca reinicia durante chamada (ver [ATUALIZACAO.md](ATUALIZACAO.md)) |

Modulos pesados (`./session`, `electron-updater`, o proprio core) sao
carregados com `require()` tardio de proposito: uma falha de import chega ao
log em vez de derrubar o app antes do primeiro log. O ESLint libera
`no-require-imports` so nessa pasta por isso.

### `src/preload/`
| Arquivo | Para que |
|---|---|
| `index.ts` | A ponte. Define exatamente o que o renderer pode chamar — nao ha `require` do lado da interface |
| `overlay.ts` | Ponte minima do overlay: so recebe a lista de participantes |

### `scripts/`
| Arquivo | Para que |
|---|---|
| `bundle.js` | Empacota o main com esbuild. Sem sourcemap em producao — o mapa carrega o TypeScript original inteiro |
| `stage.js` | Monta um diretorio isolado para empacotar. **Sem isso o electron-builder apaga as devDependencies da raiz** |
| `copy-renderer.js` | Leva o bundle do Vite para dentro do app |
| `afterPack.js` | Grava os fuses no binario: sem `RUN_AS_NODE`, sem depurador, com validacao de integridade. Acha o executavel pela plataforma alvo, entao funciona em build cruzado |

### `build/`
Icones do instalador (`icon.ico`) e da janela/bandeja (`icon.png`), gerados a
partir do `icone.png` da raiz.

---

## `apps/server/` — a ponte web (opcional)

| Arquivo | Para que |
|---|---|
| `index.ts` | Express + WebSocket: serve o build do `apps/web`, cabecalhos de seguranca, verificacao de Origin no handshake, `maxPayload`, faxina periodica e desligamento limpo |
| `wsHandler.ts` | Uma conexao = um dispositivo. Exige `session:hello` com o token antes de qualquer canal; espelha os canais do IPC do Electron |
| `session.ts` | O mesmo papel do `session.ts` do desktop, sem Electron |
| `devices.ts` | Pasta por dispositivo (`devices/<sha256 do token>`) e faxina das pastas sem conta |
| `limits.ts` | Sessoes por IP e no total, chamadas por segundo, trava apos senhas erradas, checagem de Origin |
| `*.test.ts` | Unidade e integracao com WebSocket de verdade (F5 mantem a conta, segunda aba, mensagem gigante, Origin, forca bruta) |

---

## `apps/web/` — a interface

### `pages/`
`OnboardingPage.tsx` (criar conta, frase, desbloquear, restaurar) e
`AppPage.tsx` (a tela principal: servidores, canais, chat, membros).

### `lib/`
| Arquivo | Para que |
|---|---|
| `webAdapter.ts` | `window.concord` sobre WebSocket para o modo navegador, com token de dispositivo e reconexao |

### `features/voice/`
| Arquivo | Para que |
|---|---|
| `audio/AudioEngine.ts` | Pipeline: filtro → equalizador → compressor → porta de transmissao |
| `audio/VoiceActivityDetector.ts` | Detecta fala com limiar **relativo ao ruido medido** — um valor fixo dispararia com ventilador |
| `audio/AudioMeter.ts` | RMS, pico, piso de ruido e clipping |
| `audio/RemoteAudioMixer.ts` | Volume por pessoa, mudo local e silenciamento da moderacao |
| `audio/Equalizer.ts`, `NoiseSuppression.ts` | Presets de voz e supressao plugavel |
| `audio/SoundEffects.ts` | Sons sintetizados por osciladores, sem arquivo de audio |
| `transport/PeerToPeerTransport.ts` | Malha WebRTC, um par por participante (ver [WEBRTC.md](WEBRTC.md)) |
| `transport/lowLatency.ts` | Ajustes que cortam o atraso: jitter buffer, `ptime` do Opus |
| `transport/fakeWebRtc.ts` | WebRTC simulado, so para testes: permite testar a negociacao sem navegador |
| `useVoiceCall.ts` | Junta audio, transporte e sinalizacao numa chamada de canal |
| `useDirectCall.ts`, `DirectCallOverlay.tsx` | Chamada direta para um amigo, sem servidor em comum |
| `CallStage.tsx`, `CallPanel.tsx` | O palco em grade e o painel lateral da chamada |

### `features/screenshare/`
| Arquivo | Para que |
|---|---|
| `ScreenShareEngine.ts` | Captura com controle de qualidade, pausa e troca de fonte |
| `presets.ts` | Perfis Jogo, Video, Codigo, Economia — decidem o que sacrificar sob pressao |
| `SourcePicker.tsx` | Seletor com miniaturas |
| `ScreenViewer.tsx` | Visualizador com zoom, PiP e tela cheia |

### `features/profile/`, `friends/`, `members/`, `settings/`, `update/`
Perfil e status; pedidos de amizade e popup; menu de membro (cargo, apelido,
silenciar, expulsar); configuracoes de recursos, audio e video; faixa de
atualizacao.

### `components/`
| Arquivo | Para que |
|---|---|
| `ui.tsx` | Botao, campo, avatar com status |
| `MessageText.tsx` | Links clicaveis. So `http`/`https` — outros esquemas permitiriam `javascript:` numa mensagem |
| `PromptModal.tsx` | Substitui `window.prompt()`, que o Electron nao implementa |

### Estilo
Tailwind 4, configurado direto no CSS (`styles/globals.css`, bloco `@theme`):
cores `void-*`, `violet-*`, `ink-*` e `status-*`. Nao ha `tailwind.config.js`.

---

## `packages/types/` e `packages/config/`

Contratos TypeScript compartilhados pelo core e a configuracao base do
`tsconfig`, herdada pelo core, pelos tipos e pelo desktop.

---

## Ferramentas do repositorio

| | |
|---|---|
| Testes | `node --test` no core e na ponte, Vitest na interface. 151 no total |
| Lint | ESLint (typescript-eslint + react-hooks), `eslint.config.mjs` |
| Formatacao | Prettier (`.prettierrc.json`), conferido no CI |
| CI | `.github/workflows/ci.yml`: lint, formatacao, build, testes, `npm audit` bloqueante e CodeQL em todo push e PR |
| Release | `.github/workflows/release.yml`: dispara com tag `v*` (ver [ATUALIZACAO.md](ATUALIZACAO.md)) |

## Debitos conhecidos

- `AppPage.tsx` tem perto de mil linhas e concentra estado demais. Vale
  quebrar em componentes (trilha de servidores, lista de canais, chat,
  membros) e hooks.
- A interface ainda nao tem testes de componente; a cobertura do `apps/web`
  esta na camada de voz e no adaptador web.
