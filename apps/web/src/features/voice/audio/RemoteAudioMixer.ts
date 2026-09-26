/**
 * Reproducao do audio dos outros participantes, com volume por pessoa.
 *
 * Dois caminhos de saida, escolhidos pelo volume pedido:
 *
 * - Ate 100%: o proprio elemento <audio>, via `volume`. E o caminho mais curto
 *   possivel entre o jitter buffer e a placa de som - nenhum no de
 *   processamento no meio, nenhum milissegundo a mais.
 *
 * - Acima de 100%: um GainNode do Web Audio, porque `element.volume` so
 *   atenua, nunca amplifica. Esse caminho custa alguns milissegundos de
 *   latencia, e por isso ele so entra quando alguem realmente pede reforco -
 *   quem nao mexe no controle nao paga nada.
 *
 * O elemento <audio> continua ligado ao stream mesmo no modo reforcado (mudo,
 * so para o Chromium manter o fluxo vivo): sem isso o createMediaStreamSource
 * fica em silencio, um comportamento antigo e conhecido do Chromium.
 */

/** Volume maximo. Acima disso a voz distorce mais do que ganha em clareza. */
export const VOLUME_MAXIMO = 2;

const PREFIXO_ARMAZENAMENTO = 'concord:volume:';

interface PeerAudio {
  element: HTMLAudioElement;
  stream: MediaStream | null;
  /** 0 a VOLUME_MAXIMO, onde 1 e o volume original. */
  volume: number;
  /** Silenciado pela moderacao. */
  muted: boolean;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
}

export class RemoteAudioMixer {
  private readonly peers = new Map<string, PeerAudio>();
  private context: AudioContext | null = null;
  private deafened = false;

  /** Volume salvo de uma pessoa, ou 1 quando nunca foi ajustado. */
  static volumeSalvo(peerKey: string): number {
    try {
      const bruto = localStorage.getItem(PREFIXO_ARMAZENAMENTO + peerKey);
      if (!bruto) return 1;
      const valor = Number(bruto);
      if (!Number.isFinite(valor)) return 1;
      return Math.min(VOLUME_MAXIMO, Math.max(0, valor));
    } catch {
      // Sem localStorage (janela privada, storage bloqueado): volume padrao.
      return 1;
    }
  }

  private static salvarVolume(peerKey: string, volume: number): void {
    try {
      if (volume === 1) localStorage.removeItem(PREFIXO_ARMAZENAMENTO + peerKey);
      else localStorage.setItem(PREFIXO_ARMAZENAMENTO + peerKey, String(volume));
    } catch {
      // Preferencia de conforto: perder o valor nao quebra nada.
    }
  }

  /**
   * Liga (ou religa) o audio de um peer.
   *
   * Reatribuir srcObject reinicia a reproducao e produz um estalo audivel, e
   * antes isso acontecia a cada oscilacao de rede. Por isso a atribuicao so
   * ocorre quando o stream realmente mudou de objeto.
   */
  attach(peerKey: string, stream: MediaStream): void {
    let peer = this.peers.get(peerKey);

    if (!peer) {
      const element = new Audio();
      element.autoplay = true;
      peer = {
        element,
        stream: null,
        volume: RemoteAudioMixer.volumeSalvo(peerKey),
        muted: false,
        source: null,
        gain: null,
      };
      this.peers.set(peerKey, peer);
    }

    if (peer.stream !== stream) {
      peer.stream = stream;
      peer.element.srcObject = stream;
      // Trocar o stream invalida o no de origem do Web Audio, que aponta para
      // o objeto antigo.
      this.desligarReforco(peer);
      void peer.element.play().catch(() => undefined);
    }

    this.aplicar(peerKey, peer);
  }

  detach(peerKey: string): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    this.desligarReforco(peer);
    peer.element.srcObject = null;
    peer.element.pause();
    this.peers.delete(peerKey);
  }

  volumeDe(peerKey: string): number {
    return this.peers.get(peerKey)?.volume ?? RemoteAudioMixer.volumeSalvo(peerKey);
  }

  setVolume(peerKey: string, volume: number): void {
    const limitado = Math.min(VOLUME_MAXIMO, Math.max(0, volume));
    RemoteAudioMixer.salvarVolume(peerKey, limitado);
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    peer.volume = limitado;
    this.aplicar(peerKey, peer);
  }

  setMuted(peerKey: string, muted: boolean): void {
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    peer.muted = muted;
    this.aplicar(peerKey, peer);
  }

  /** Silencia tudo de uma vez, sem perder o volume individual de cada um. */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const [key, peer] of this.peers) this.aplicar(key, peer);
  }

  keys(): string[] {
    return [...this.peers.keys()];
  }

  stop(): void {
    for (const key of [...this.peers.keys()]) this.detach(key);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.deafened = false;
  }

  private aplicar(_peerKey: string, peer: PeerAudio): void {
    const alvo = peer.muted || this.deafened ? 0 : peer.volume;

    if (alvo <= 1) {
      this.desligarReforco(peer);
      peer.element.muted = alvo === 0;
      peer.element.volume = alvo;
      return;
    }

    if (!this.ligarReforco(peer)) {
      // Web Audio indisponivel: melhor entregar 100% do que silencio.
      peer.element.muted = false;
      peer.element.volume = 1;
      return;
    }

    peer.element.muted = true;
    if (peer.gain) peer.gain.gain.value = alvo;
  }

  private ligarReforco(peer: PeerAudio): boolean {
    if (peer.gain && peer.source) return true;
    if (!peer.stream) return false;

    try {
      if (!this.context) {
        // 'interactive' pede o menor buffer de saida que o sistema aceita.
        this.context = new AudioContext({ latencyHint: 'interactive' });
      }
      // O contexto pode nascer suspenso; sem retomar, nao sai som.
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);

      peer.source = this.context.createMediaStreamSource(peer.stream);
      peer.gain = this.context.createGain();
      peer.source.connect(peer.gain);
      peer.gain.connect(this.context.destination);
      return true;
    } catch {
      this.desligarReforco(peer);
      return false;
    }
  }

  private desligarReforco(peer: PeerAudio): void {
    try {
      peer.source?.disconnect();
      peer.gain?.disconnect();
    } catch {
      // Nos ja desconectados: nada a fazer.
    }
    peer.source = null;
    peer.gain = null;
  }
}
