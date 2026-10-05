/**
 * WebRTC de mentira para testar o PeerToPeerTransport sem navegador.
 *
 * Reproduz so o que importa para a sinalizacao: a maquina de estados
 * (stable / have-local-offer / have-remote-offer), o rollback implicito do
 * lado polite numa colisao, candidates que exigem descricao remota, e a
 * entrega de faixas remotas quando uma descricao anuncia uma m-line nova.
 * Midia de verdade nao trafega - nao e o que esta sendo testado.
 */

type Listener = () => void;

let seq = 0;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class FakeTrack {
  readonly id = `track-${++seq}`;
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly kind: 'audio' | 'video') {}

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  end(): void {
    for (const fn of this.listeners.get('ended') ?? []) fn();
  }
}

export class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  addTrack(t: FakeTrack): void {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

export class FakeSender {
  params: RTCRtpSendParameters = { encodings: [] } as unknown as RTCRtpSendParameters;
  setParametersCalls: RTCRtpSendParameters[] = [];
  constructor(public track: FakeTrack | null) {}

  async replaceTrack(t: FakeTrack | null): Promise<void> {
    this.track = t;
  }
  getParameters(): RTCRtpSendParameters {
    return JSON.parse(JSON.stringify(this.params));
  }
  async setParameters(p: RTCRtpSendParameters): Promise<void> {
    this.setParametersCalls.push(p);
    this.params = p;
  }
}

export class FakeTransceiver {
  readonly mid: string;
  readonly sender: FakeSender;
  codecPreferences: { mimeType: string }[] | null = null;
  constructor(
    owner: FakePeerConnection,
    readonly kind: 'audio' | 'video',
    track: FakeTrack,
    public direction: RTCRtpTransceiverDirection,
  ) {
    this.mid = `${owner.id}:${owner.transceivers.length}`;
    this.sender = new FakeSender(track);
  }
  setCodecPreferences(codecs: { mimeType: string }[]): void {
    this.codecPreferences = codecs;
  }
}

interface FakeDescription {
  type: RTCSdpType;
  sdp: string;
  toJSON(): { type: RTCSdpType; sdp: string };
}

function descricao(type: RTCSdpType, sdp: string): FakeDescription {
  return { type, sdp, toJSON: () => ({ type, sdp }) };
}

export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  readonly id = `pc${++seq}`;
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: FakeDescription | null = null;
  remoteDescription: FakeDescription | null = null;
  readonly transceivers: FakeTransceiver[] = [];
  readonly candidates: RTCIceCandidateInit[] = [];
  readonly offerOptions: (RTCOfferOptions | undefined)[] = [];
  restartIceCalls = 0;
  closed = false;
  /** Faz o proximo setRemoteDescription falhar, como um SDP corrompido faria. */
  failNextRemote = false;

  /** m-lines remotas que ja viraram faixa local - cada uma so dispara uma vez. */
  private readonly entregues = new Set<string>();

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null =
    null;
  ontrack: ((e: { track: FakeTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(
    track: FakeTrack,
    init: { direction: RTCRtpTransceiverDirection },
  ): FakeTransceiver {
    const t = new FakeTransceiver(this, track.kind, track, init.direction);
    this.transceivers.push(t);
    this.precisaNegociar();
    return t;
  }

  private precisaNegociar(): void {
    queueMicrotask(() => this.onnegotiationneeded?.());
  }

  /** SDP minimo: uma m-line por transceiver que envia, com Opus no audio. */
  private gerarSdp(): string {
    const linhas = ['v=0'];
    for (const t of this.transceivers) {
      if (!t.sender.track || t.direction === 'inactive' || t.direction === 'recvonly') continue;
      linhas.push(`m=${t.kind} 9 UDP/TLS/RTP/SAVPF 111`, `a=mid:${t.mid}`);
      if (t.kind === 'audio') {
        linhas.push('a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1');
      }
    }
    return linhas.join('\r\n');
  }

  async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    await tick();
    this.offerOptions.push(options);
    return { type: 'offer', sdp: this.gerarSdp() };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    await tick();
    if (this.signalingState !== 'have-remote-offer') {
      throw new Error(`createAnswer em ${this.signalingState}`);
    }
    return { type: 'answer', sdp: this.gerarSdp() };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await tick();
    this.localDescription = descricao(desc.type!, desc.sdp ?? '');
    if (desc.type === 'offer') this.signalingState = 'have-local-offer';
    if (desc.type === 'answer') {
      this.signalingState = 'stable';
      this.conectar();
    }
    queueMicrotask(() =>
      this.onicecandidate?.({
        candidate: { toJSON: () => ({ candidate: `cand-${this.id}-${++seq}`, sdpMid: '0' }) },
      }),
    );
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    await tick();
    if (this.failNextRemote) {
      this.failNextRemote = false;
      throw new Error('SDP invalido');
    }
    if (desc.type === 'offer') {
      // Rollback implicito: o lado polite descarta a propria offer em colisao.
      if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') {
        throw new Error(`offer remota em ${this.signalingState}`);
      }
      this.signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      if (this.signalingState !== 'have-local-offer') {
        throw new Error(`answer remota em ${this.signalingState}`);
      }
      this.signalingState = 'stable';
      this.conectar();
    }
    this.remoteDescription = descricao(desc.type!, desc.sdp ?? '');
    this.entregarFaixas(desc.sdp ?? '');
  }

  private entregarFaixas(sdp: string): void {
    const linhas = sdp.split('\r\n');
    linhas.forEach((linha, i) => {
      const m = linha.match(/^m=(audio|video) /);
      if (!m) return;
      const mid = linhas[i + 1]?.replace('a=mid:', '') ?? `${i}`;
      if (this.entregues.has(mid)) return;
      this.entregues.add(mid);
      const track = new FakeTrack(m[1] as 'audio' | 'video');
      queueMicrotask(() => this.ontrack?.({ track }));
    });
  }

  private conectar(): void {
    if (this.connectionState === 'connected') return;
    this.setConnectionState('connected');
  }

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    await tick();
    if (!this.remoteDescription) throw new Error('candidate sem descricao remota');
    this.candidates.push(c);
  }

  restartIce(): void {
    this.restartIceCalls++;
    this.precisaNegociar();
  }

  getReceivers(): unknown[] {
    return [];
  }

  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }

  close(): void {
    this.closed = true;
  }
}

export const FAKE_VIDEO_CODECS = [
  { mimeType: 'video/H264' },
  { mimeType: 'video/VP8' },
  { mimeType: 'video/rtx' },
  { mimeType: 'video/AV1' },
  { mimeType: 'video/VP9' },
];

/** Instala os fakes como globais do navegador. Devolve a funcao que desfaz. */
export function installFakeWebRtc(): () => void {
  const g = globalThis as Record<string, unknown>;
  const antes = {
    RTCPeerConnection: g.RTCPeerConnection,
    MediaStream: g.MediaStream,
    RTCRtpSender: g.RTCRtpSender,
  };
  FakePeerConnection.instances = [];
  g.RTCPeerConnection = FakePeerConnection;
  g.MediaStream = FakeMediaStream;
  g.RTCRtpSender = { getCapabilities: () => ({ codecs: FAKE_VIDEO_CODECS, headerExtensions: [] }) };
  return () => Object.assign(g, antes);
}
