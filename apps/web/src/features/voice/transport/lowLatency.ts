/**
 * Ajustes de baixa latencia para WebRTC.
 *
 * Latencia zero nao existe: o piso e RTT/2 mais codificacao e decodificacao.
 * O que da para eliminar e o buffer que o navegador acrescenta por conta
 * propria, que costuma ser maior que tudo o mais somado.
 */

/**
 * Alvo do jitter buffer em segundos.
 *
 * O padrao do Chromium e adaptativo e costuma parar entre 40 e 200 ms, porque
 * ele otimiza para nao falhar em rede ruim. Em conversa ao vivo esse buffer e
 * exatamente o atraso que se sente. Zero pede o minimo possivel; a troca e
 * mais engasgo quando a rede oscila.
 */
export const JITTER_TARGET_LOW = 0;
export const JITTER_TARGET_STABLE = 0.12;

export interface LatencyProfile {
  id: 'ultra' | 'equilibrado';
  label: string;
  description: string;
  jitterTarget: number;
  /** Duracao do pacote Opus em ms. Menor = menos atraso, mais overhead. */
  ptime: number;
  /** Compressor adiciona lookahead; desligar economiza alguns ms. */
  useCompressor: boolean;
  /** Tempo de ataque do detector de voz, em ms. */
  vadAttackMs: number;
}

export const LATENCY_PROFILES: Record<LatencyProfile['id'], LatencyProfile> = {
  ultra: {
    id: 'ultra',
    label: 'Ultra baixa',
    description: 'Minimo atraso possivel. Pode engasgar em rede instavel.',
    jitterTarget: JITTER_TARGET_LOW,
    ptime: 10,
    useCompressor: false,
    vadAttackMs: 12,
  },
  equilibrado: {
    id: 'equilibrado',
    label: 'Equilibrado',
    description: 'Um pouco de buffer para aguentar oscilacao da rede.',
    jitterTarget: JITTER_TARGET_STABLE,
    ptime: 20,
    useCompressor: true,
    vadAttackMs: 40,
  },
};

/**
 * Pede ao receptor que segure o minimo de audio/video antes de reproduzir.
 *
 * `jitterBufferTarget` e o caminho atual; `playoutDelayHint` e o antecessor
 * nao padronizado. Aplicamos os dois porque ambos existem neste Chromium e o
 * custo de definir o que ja esta ignorado e nulo.
 */
export function tuneReceiver(receiver: RTCRtpReceiver, targetSeconds: number): void {
  const alvo = receiver as RTCRtpReceiver & {
    jitterBufferTarget?: number | null;
    playoutDelayHint?: number | null;
  };
  try {
    if ('jitterBufferTarget' in alvo) alvo.jitterBufferTarget = targetSeconds;
  } catch {
    // Navegador pode recusar valores fora da faixa aceita.
  }
  try {
    if ('playoutDelayHint' in alvo) alvo.playoutDelayHint = targetSeconds;
  } catch {
    // idem
  }
}

export function tuneAllReceivers(pc: RTCPeerConnection, targetSeconds: number): void {
  for (const receiver of pc.getReceivers()) tuneReceiver(receiver, targetSeconds);
}

/**
 * Reescreve a linha fmtp do Opus.
 *
 * O SDP gerado pelo Chromium traz `minptime=10`, que apenas informa o minimo
 * aceito - a negociacao acaba em pacotes de 20 ms. `ptime` e o que realmente
 * pede 10 ms, cortando metade do atraso de empacotamento.
 *
 * `usedtx=0` importa aqui: com DTX ligado o encoder para de transmitir no
 * silencio e a primeira silaba chega atrasada.
 */
export function applyOpusLowLatency(sdp: string, ptime: number): string {
  const linhas = sdp.split('\r\n');

  // Descobre o payload type negociado para Opus em vez de assumir 111.
  const rtpmap = linhas.find((l) => /^a=rtpmap:\d+ opus\/48000/i.test(l));
  if (!rtpmap) return sdp;

  const payload = rtpmap.match(/^a=rtpmap:(\d+)/)?.[1];
  if (!payload) return sdp;

  const parametros = [
    `minptime=${ptime}`,
    'useinbandfec=1',
    // Sem correcao de erro em rajada o audio fica pior justamente quando a
    // latencia baixa expoe cada perda.
    'usedtx=0',
    'stereo=0',
  ];

  const resultado: string[] = [];
  let fmtpEncontrado = false;

  for (const linha of linhas) {
    if (linha.startsWith(`a=fmtp:${payload} `)) {
      fmtpEncontrado = true;
      const existentes = linha
        .slice(`a=fmtp:${payload} `.length)
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p && !parametros.some((novo) => p.startsWith(novo.split('=')[0] + '=')));
      resultado.push(`a=fmtp:${payload} ${[...parametros, ...existentes].join(';')}`);
      continue;
    }
    resultado.push(linha);

    // `a=ptime` vale para a secao de midia inteira e precisa vir logo apos o
    // rtpmap correspondente.
    if (linha === rtpmap) {
      resultado.push(`a=ptime:${ptime}`);
      resultado.push(`a=maxptime:${Math.max(ptime, 20)}`);
    }
  }

  if (!fmtpEncontrado) {
    const indice = resultado.indexOf(rtpmap);
    if (indice >= 0) {
      resultado.splice(indice + 1, 0, `a=fmtp:${payload} ${parametros.join(';')}`);
    }
  }

  return resultado.join('\r\n');
}

/** Latencia estimada de ponta a ponta, a partir de metricas reais. */
export interface LatencyBreakdown {
  /** Metade do round-trip: o caminho de ida. */
  networkMs: number | null;
  /** Quanto o receptor esta segurando antes de reproduzir. */
  jitterBufferMs: number | null;
  /** Soma do que conseguimos medir. Nao inclui captura nem saida de audio. */
  totalMs: number | null;
}

/**
 * Extrai a latencia medida do relatorio do WebRTC.
 *
 * `jitterBufferDelay` e acumulado em segundos e precisa ser dividido pelo
 * numero de amostras emitidas para virar a media atual.
 */
export function readLatency(report: RTCStatsReport): LatencyBreakdown {
  let networkMs: number | null = null;
  let jitterBufferMs: number | null = null;

  report.forEach((entry) => {
    const stat = entry as never as Record<string, number | string | undefined>;

    if (entry.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
      if (stat.currentRoundTripTime !== undefined) {
        networkMs = (Number(stat.currentRoundTripTime) * 1000) / 2;
      }
    }

    if (entry.type === 'inbound-rtp' && stat.kind === 'audio') {
      const delay = Number(stat.jitterBufferDelay ?? 0);
      const emitted = Number(stat.jitterBufferEmittedCount ?? 0);
      if (emitted > 0) jitterBufferMs = (delay / emitted) * 1000;
    }
  });

  const total =
    networkMs !== null || jitterBufferMs !== null
      ? (networkMs ?? 0) + (jitterBufferMs ?? 0)
      : null;

  return { networkMs, jitterBufferMs, totalMs: total };
}
