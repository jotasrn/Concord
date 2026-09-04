# Arquitetura

Concord é um app de comunicação **P2P local-first**: não existe servidor. Cada
pessoa instala um executável, cria a conta na própria máquina e replica os
dados dos outros. Quem volta de offline puxa dos peers o que perdeu.

## Os três processos

```
┌──────────────────────────────────────────────────────────┐
│  Electron: processo PRINCIPAL (Node)                      │
│  Onde vive tudo o que é privilegiado                      │
│                                                           │
│   apps/desktop/src/main/  ──usa──▶  packages/core/        │
│                                     identidade, log,      │
│                                     SQLite, rede P2P      │
└───────────────────────────┬──────────────────────────────┘
                            │ IPC (única ponte)
┌───────────────────────────┴──────────────────────────────┐
│  Electron: processo RENDERER (Chromium, sem Node)         │
│  apps/web/  ── React, WebRTC, captura de áudio e tela     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Janela do OVERLAY (transparente, sobre jogos)            │
│  apps/web/overlay.html + src/overlay.ts                   │
└──────────────────────────────────────────────────────────┘
```

O renderer **não tem acesso ao Node**. Tudo que toca disco, rede ou sistema
passa pelo IPC, que valida a entrada no processo principal.

## Regra central: operação vs. efêmero

Duas categorias de dado, com destinos opostos:

| | Vai para o log assinado | Vive só na conexão |
|---|---|---|
| **O quê** | mensagens, canais, membros, perfil | status, quem está em call, sinalização WebRTC |
| **Por quê** | precisa sobreviver e replicar | registrar isso encheria o log de ruído para sempre |

**Estado que não é operação não existe** — não replica e some quando a projeção
é reconstruída.

---

## `packages/core/` — o núcleo (roda no processo principal)

O coração do app. Não depende de Electron nem de React.

### `identity/`
| Arquivo | Para quê |
|---|---|
| `keypair.ts` | Ed25519 pelo crypto nativo do Node: assinar e verificar. Gera o `#a3f9` do seu nome |
| `keystore.ts` | Frase de recuperação (12 palavras) e keystore cifrado com scrypt + AES-256-GCM |
| `identity.test.ts` | 11 testes, incluindo recuperar a conta em outra máquina só com a frase |

### `crypto/`
| Arquivo | Para quê |
|---|---|
| `serverKey.ts` | Chave por servidor, tópico da DHT, cifra das operações, código de convite, tópico pessoal (caixa de entrada) |
| `vault.ts` | Cifra o que vai para o disco. A chave sai da sua identidade e só existe depois do desbloqueio |
| `*.test.ts` | Verificam que o `.db` em disco não contém mensagem legível |

### `ops/` — o log replicado
| Arquivo | Para quê |
|---|---|
| `types.ts` | As operações possíveis e o formato de cada payload |
| `canonical.ts` | Serialização com chaves ordenadas. Sem isso a mesma operação geraria assinaturas diferentes em cada máquina |
| `sign.ts` | Assina, verifica e define a **ordem total** (lamport, autor, seq) que faz todos convergirem |
| `validate.ts` | Formato e limites do que vem da rede. Substitui os casts, que não verificam nada em runtime |
| `reducer.ts` | Aplica as operações ao SQLite conferindo permissão a cada uma |
| `ops.test.ts` | 13 testes, incluindo convergência de dois peers com ordens diferentes |
| `hostile.test.ts` | 6 testes com peer mal-intencionado: payload nulo, tipo errado, mensagem gigante |

### `db/`
| Arquivo | Para quê |
|---|---|
| `schema.ts` | Tabelas. Separa o **log** (fonte da verdade) da **projeção** (cache da interface) |
| `database.ts` | Abertura, migração de colunas e acesso ao log |

### `p2p/`
| Arquivo | Para quê |
|---|---|
| `protocol.ts` | Mensagens trocadas entre peers e o enquadramento por linha |
| `node.ts` | Descoberta pela DHT, prova de identidade, sincronização, presença e caixa de entrada |
| `hyperswarm.d.ts` | Tipos da lib, que não publica os próprios |

### Raiz
| Arquivo | Para quê |
|---|---|
| `store.ts` | **A única porta de entrada.** A interface nunca fala com SQLite ou rede direto |
| `social.ts` | Amizades e convites pendentes — ficam fora do log porque não pertencem a servidor nenhum |

---

## `apps/desktop/` — o processo principal

### `src/main/`
| Arquivo | Para quê |
|---|---|
| `index.ts` | Cria a janela, aplica limites de recurso, bloqueia DevTools e navegação externa |
| `diagnostics.ts` | **Carregado primeiro.** Sem ele, uma falha de import vira uma caixa "Error" sem rastro |
| `session.ts` | Estado vivo: identidade destrancada, banco e nó P2P |
| `ipc.ts` | Todos os canais entre interface e núcleo, num envelope `{ ok, data }` |
| `settings.ts` | Preferências, limite de memória e afinidade de CPU |
| `background.ts` | Bandeja, esconder ao fechar e bloqueio de suspensão durante chamadas |
| `overlay.ts` | Janela transparente com as bolinhas de quem está falando |

### `src/preload/`
| Arquivo | Para quê |
|---|---|
| `index.ts` | A ponte. Define exatamente o que o renderer pode chamar — não há `require` do lado da interface |
| `overlay.ts` | Ponte mínima do overlay: só recebe a lista de participantes |

### `scripts/`
| Arquivo | Para quê |
|---|---|
| `bundle.js` | Empacota o main com esbuild. Sem sourcemap em produção — o mapa carrega o TypeScript original inteiro |
| `stage.js` | Monta um diretório isolado para empacotar. **Sem isso o electron-builder apaga as devDependencies da raiz** |
| `copy-renderer.js` | Leva o bundle do Vite para dentro do app |
| `afterPack.js` | Grava os fuses no binário: sem `RUN_AS_NODE`, sem depurador, com validação de integridade |

---

## `apps/web/` — a interface

### `pages/`
`OnboardingPage.tsx` (criar conta, frase, desbloquear) e `AppPage.tsx` (a tela
principal: servidores, canais, chat, membros).

### `features/voice/`
| Arquivo | Para quê |
|---|---|
| `audio/AudioEngine.ts` | Pipeline: filtro → equalizador → compressor → porta de transmissão |
| `audio/VoiceActivityDetector.ts` | Detecta fala com limiar **relativo ao ruído medido** — um valor fixo dispararia com ventilador |
| `audio/AudioMeter.ts` | RMS, pico, piso de ruído e clipping |
| `audio/Equalizer.ts`, `NoiseSuppression.ts` | Presets de voz e supressão plugável |
| `audio/SoundEffects.ts` | Sons sintetizados por osciladores, sem arquivo de áudio |
| `transport/PeerToPeerTransport.ts` | Malha WebRTC, um par por participante |
| `transport/lowLatency.ts` | Ajustes que cortam o atraso: jitter buffer, `ptime` do Opus |
| `useVoiceCall.ts` | Junta áudio, transporte e sinalização numa chamada |
| `CallStage.tsx` | O palco em grade com todos, incluindo sua própria transmissão |

### `features/screenshare/`
| Arquivo | Para quê |
|---|---|
| `ScreenShareEngine.ts` | Captura com controle de qualidade, pausa e troca de fonte |
| `presets.ts` | Perfis Jogo, Vídeo, Código, Economia — decidem o que sacrificar sob pressão |
| `SourcePicker.tsx` | Seletor com miniaturas |
| `ScreenViewer.tsx` | Visualizador com zoom, PiP e tela cheia |

### `features/profile/`, `friends/`, `settings/`
Perfil e status; pedidos de amizade e popup; configurações de recursos e vídeo.

### `components/`
| Arquivo | Para quê |
|---|---|
| `ui.tsx` | Botão, campo, avatar com status |
| `MessageText.tsx` | Links clicáveis. Só `http`/`https` — outros esquemas permitiriam `javascript:` numa mensagem |
| `PromptModal.tsx` | Substitui `window.prompt()`, que o Electron não implementa |

---

## Sobras da primeira versão

O projeto começou como cliente-servidor e virou P2P. Restaram andaimes:

| Item | Situação |
|---|---|
| `packages/ui/` | **Vazio e não usado** por ninguém |
| `packages/shared/` | **Não é importado** em lugar nenhum |
| `packages/types/` | Usado só por `core` e `shared` |
| 13 pastas com `.gitkeep` | Da estrutura planejada na Fase 1; várias nunca receberam arquivo |
| `.env.example` | Da época do Postgres/Redis; hoje não há variável de ambiente |

Nada disso quebra o app, mas dá a impressão de que existe mais estrutura do que
realmente existe.
