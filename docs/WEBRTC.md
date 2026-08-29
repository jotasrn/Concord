# WebRTC

> **Estado:** a infraestrutura (coturn, contratos de sinalizacao em `packages/types`) esta pronta.
> A implementacao de `WebRTCService` e dos gateways de voz entra nas Fases 7–10.

## Topologia

Malha P2P (full mesh) para ate ~6 participantes. Justificativa e limites em
[ARCHITECTURE.md](ARCHITECTURE.md#4-webrtc-malha-mesh-no-mvp-sfu-depois).

## Fluxo de sinalizacao

O servidor NestJS roteia SDP e ICE candidates entre pares — nunca inspeciona nem reescreve o
conteudo. A midia nao passa pela API.

```
Usuario A                  Signaling (Socket.IO)                 Usuario B
    │                              │                                 │
    │──── voice:join ─────────────▶│                                 │
    │                              │──── rtc:peer-joined ───────────▶│
    │                              │                                 │
    │  createOffer()               │                                 │
    │──── rtc:offer ──────────────▶│──── rtc:offer ─────────────────▶│
    │                              │                    createAnswer()│
    │◀─── rtc:answer ──────────────│◀─── rtc:answer ─────────────────│
    │                              │                                 │
    │──── rtc:ice-candidate ──────▶│──── rtc:ice-candidate ─────────▶│
    │◀─── rtc:ice-candidate ───────│◀─── rtc:ice-candidate ──────────│
    │                              │                                 │
    │◀═════════ midia SRTP direta (ou via TURN) ══════════════════▶ │
```

Os nomes de evento e os formatos de payload sao definidos em
[`packages/types/src/events.ts`](../packages/types/src/events.ts) e importados pelos dois lados,
para que um typo quebre o build em vez de criar um canal morto.

## Regras de implementacao

1. **Toda a logica de PeerConnection fica em `WebRTCService`**, fora dos componentes React.
   Um `useEffect` que cria PeerConnections roda duas vezes sob StrictMode e vaza conexoes.
2. **Perfect negotiation**: cada par define um lado `polite` (determinado por comparacao dos IDs
   de usuario) para resolver colisao de offers sem deadlock.
3. **Trickle ICE**: candidates sao enviados assim que aparecem, sem esperar o fim da coleta.
4. **Streams separados por tipo**: microfone, camera e tela sao tracks distintas na mesma
   PeerConnection. Compartilhar tela usa `replaceTrack` em vez de renegociar do zero quando
   possivel.
5. **Qualidade de conexao vem de `getStats()`** — `roundTripTime`, `packetsLost`, `jitter`.
   O indicador na UI reflete metricas reais, nunca um valor estimado.

## STUN / TURN

- **STUN**: descobre o IP publico do cliente. Resolve a maioria dos NATs domesticos.
- **TURN**: relay de midia quando a conexao direta e impossivel (NAT simetrico, redes
  corporativas). Custa banda do servidor — todo o trafego passa por ele.

Na pratica, ~10–20% das conexoes precisam de TURN. Sem TURN configurado, esses usuarios
simplesmente nao conseguem se conectar, e o sintoma e uma call que "fica conectando" sem erro
explicito.

### Configuracao local

```bash
cp infrastructure/turn/turnserver.conf.example infrastructure/turn/turnserver.conf
```

Troque `CHANGE_ME` pela senha de `TURN_PASSWORD` no `.env`. O arquivo `turnserver.conf` real e
gitignorado por conter o segredo.

```bash
docker compose up -d coturn
```

O coturn roda com `network_mode: host`. Isso e necessario: o relay usa uma faixa dinamica de
portas UDP (49160–49200 na configuracao padrao) e mapear cada uma via bridge do Docker e
impraticavel.

### Verificar se o TURN responde

Use o [Trickle ICE do WebRTC](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
com `turn:localhost:3478`, usuario `concord` e a senha configurada. Um candidate do tipo `relay`
confirma que o TURN esta funcionando.

### Producao

Tres mudancas obrigatorias em relacao ao dev:

1. **`external-ip`**: descomente e aponte para o IP publico do host. Sem isso o coturn anuncia o
   IP privado e o relay falha atras de cloud NAT.
2. **Credenciais temporarias**: troque `lt-cred-mech` + usuario fixo por `use-auth-secret` com
   `static-auth-secret`. A API passa a gerar credenciais HMAC com validade curta por sessao, em
   vez de expor uma senha permanente ao cliente.
3. **TLS**: habilite `cert`/`pkey` na porta 5349 (TURNS). Redes que bloqueiam UDP frequentemente
   liberam TCP 443 — vale expor TURNS nessa porta.

Abra no firewall: **3478/udp**, **3478/tcp**, **5349/tcp** e a faixa de relay **49160–49200/udp**.

## Testes obrigatorios antes de considerar a fase concluida

Com dois navegadores em maquinas diferentes (nao duas abas na mesma maquina — isso nao exercita
o NAT):

- [ ] Audio nos dois sentidos
- [ ] Video nos dois sentidos
- [ ] Compartilhamento de tela
- [ ] Troca de tela compartilhada sem derrubar a call
- [ ] Entrada de um terceiro participante
- [ ] Saida de um participante sem afetar os demais
- [ ] Reconexao apos queda de rede (ICE restart)
- [ ] Conexao forcando relay (`iceTransportPolicy: 'relay'`) para validar o TURN
