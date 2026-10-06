# WebRTC

Nao ha SFU nem servidor de sinalizacao dedicado. A sinalizacao viaja pela
mesma conexao Hyperswarm ja aberta e cifrada entre os dois peers - a diferenca
para uma chamada de canal e uma chamada direta e so **por onde** a mensagem
entra na malha, nunca como o WebRTC em si funciona. Implementacao em
`apps/web/src/features/voice/transport/PeerToPeerTransport.ts`.

## Topologia

Malha completa (full mesh): uma `RTCPeerConnection` por participante. Cada
pessoa envia sua propria faixa a todo mundo e recebe uma de cada um dos
outros. Escala bem ate ~6-8 participantes; acima disso o upload de quem
transmite vira o gargalo, porque a mesma faixa e enviada N-1 vezes. Um SFU
resolveria isso centralizando o encaminhamento - mas exigiria um servidor, o
que contradiz a premissa do projeto. `VoiceTransport` (interface em
`transport/VoiceTransport.ts`) existe justamente para isolar essa decisao: se
um dia fizer sentido trocar a malha por um SFU, a camada de audio (motor,
medidores, VAD) nao muda uma linha.

## Sinalizacao: dois caminhos, mesmo protocolo

| | Canal de voz de servidor | Chamada direta |
| --- | --- | --- |
| Transporte | `voice:signal` (IPC) → cifrado com a chave do servidor | `calls:signal` (IPC) → sem cifra propria, a conexao ja e direta e autenticada |
| Alcance | difunde para todos no canal, ou so para um `to` especifico | sempre 1 destinatario |
| `channelId` | o canal de voz de verdade | um `callId` (UUID) gerado na hora de ligar |

Os sinais em si (`join`, `offer`, `answer`, `ice`, `state`, `leave`) sao os
mesmos nos dois casos - so muda o envelope que carrega cada um ate o peer
certo.

Antes de sair para a rede, todo sinal passa por `parseVoiceSignal`
(`packages/core/src/p2p/protocol.ts`), no processo principal ou na ponte web:
tipo conhecido, `channelId` de ate 128 caracteres, `to` como chave hex valida
e no maximo 64 KB de dados. Um SDP com video e simulcast fica em poucos KB;
o teto so barra lixo e abuso.

## Perfect negotiation

Dois peers podem tentar renegociar ao mesmo tempo (ex: os dois comecam a
compartilhar tela junto). Em vez de coordenar quem fala primeiro, cada par
decide sozinho quem cede numa colisao: comparando as chaves publicas (`polite = minhaChave < chaveDoOutro`),
o resultado e deterministico e identico dos dois lados sem round-trip extra.

Sinais de um mesmo peer sao processados **em fila**, um por vez
(`PeerToPeerTransport` mantem uma `Promise` encadeada por peer). Sem isso,
dois sinais que chegam juntos entram em `handleSignal` ao mesmo tempo e se
atropelam nos `await` - foi exatamente o que travava a imagem quando duas
pessoas comecavam a transmitir tela ao mesmo tempo.

## Latencia

Dois perfis (`transport/lowLatency.ts`):

| Perfil | Jitter buffer | `ptime` do Opus | Compressor |
| --- | --- | --- | --- |
| **Ultra** (padrao) | 0s (`jitterBufferTarget`) | 10ms | desligado |
| **Equilibrado** | 0.12s | 20ms | ligado |

`ptime=10` reescreve o SDP para pedir pacotes de 10ms em vez dos 20ms que o
Chromium negocia por padrao - corta metade do atraso de empacotamento.
`usedtx=0` mantem o encoder transmitindo no silencio: DTX cortaria a primeira
silaba de cada fala. O bitrate e fixado em 64kbps mono
(`OPUS_BITRATE_BPS`), porque sem isso o Chromium fica perto de 32kbps e a voz
fica metalica bem no momento em que uma transmissao de tela divide o mesmo
caminho de rede.

## Codecs de video

`RTCRtpTransceiver.setCodecPreferences` prioriza **AV1 > VP9 > VP8 > H264**
para compartilhamento de tela: os dois primeiros comprimem texto e areas
estaticas muito melhor, o que importa justamente em codigo e planilha, onde
borrao e inaceitavel.

## Deteccao de fala

`getSynchronizationSources()` no receptor de audio devolve o `audioLevel` que
o proprio WebRTC ja calculou ao decodificar - sem custo extra, sem
`AnalyserNode` proprio. Um limiar com um pouco de histerese (300ms) decide
"esta falando" sem piscar entre silabas.

## Recuperacao de conexao

`disconnected` no WebRTC nunca vira `failed` sozinho quando a rede volta a
funcionar - a conexao so fica presa. Um temporizador de 4s forca
`restartIce()` se o estado nao se resolver sozinho nesse tempo.
`reconnectAll()` (botao manual na interface) faz o mesmo para todos os peers
de uma vez, para quando a recuperacao automatica ainda nao agiu.

## Como e testado

WebRTC de verdade exige navegador e rede, entao os testes usam um WebRTC
simulado (`transport/fakeWebRtc.ts`) que reproduz o que importa para a
sinalizacao: a maquina de estados (`stable` / `have-local-offer` /
`have-remote-offer`), o rollback implicito do lado polite, candidates que
exigem descricao remota e a chegada de faixas quando uma m-line nova aparece.
Midia nao trafega - nao e o que esta sendo testado.

`PeerToPeerTransport.test.ts` liga dois transportes por uma "rede" em memoria
e cobre: conexao entre dois peers, colisao de offers, candidates antes da
offer, a fila por peer, `leave`/`disconnect`, tela (chegada, parada, reuso do
transceiver, ordem de codecs, pedido de reenvio apos 5s com reinicio de ICE)
e a recuperacao de `disconnected`/`failed`. `lowLatency.test.ts` cobre a
reescrita do SDP e a leitura de latencia.

A suite foi conferida por mutacao: inverter quem e polite, tirar o buffer de
candidates, tirar a fila, tirar o temporizador de recuperacao ou ignorar
`leave` faz um teste falhar em cada caso.

## Sem TURN

So ha STUN publico (`stun.l.google.com`, `stun1.l.google.com`). Cobre a
maioria das combinacoes de NAT via hole punching; NAT simetrico dos dois
lados ao mesmo tempo pode falhar em conectar. Adicionar TURN exigiria um
servidor relay - de novo, contra a premissa do projeto - entao essa e uma
limitacao conhecida e aceita, nao um bug.
