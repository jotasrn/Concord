import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerEvents, PeerToPeerTransport, SignalSender } from './PeerToPeerTransport';
import { FakePeerConnection, FakeTrack, FakeTransceiver, installFakeWebRtc } from './fakeWebRtc';

type Sinal = Parameters<SignalSender>[0];

// Ordem lexicografica decide quem cede: A < B, entao A e o polite.
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const CANAL = 'canal-voz';

const faixa = (kind: 'audio' | 'video') => new FakeTrack(kind) as unknown as MediaStreamTrack;

function eventos() {
  return {
    onAudio: vi.fn<PeerEvents['onAudio']>(),
    onScreen: vi.fn<PeerEvents['onScreen']>(),
    onScreenPaused: vi.fn<PeerEvents['onScreenPaused']>(),
    onPeerLeft: vi.fn<PeerEvents['onPeerLeft']>(),
    onConnectionChange: vi.fn<PeerEvents['onConnectionChange']>(),
  };
}

/** Deixa a fila de microtasks e timers zerados esvaziar algumas vezes. */
async function assentar(rodadas = 30): Promise<void> {
  for (let i = 0; i < rodadas; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Dois participantes ligados por uma "rede" em memoria que faz o papel da
 * conexao Hyperswarm: entrega assincrona, respeita `to` e carimba `from`.
 */
function sala() {
  const enviados: { de: string; sinal: Sinal }[] = [];
  const transportes = new Map<string, PeerToPeerTransport>();
  const ev = { [A]: eventos(), [B]: eventos() };
  let derrubarDe: string | null = null;

  const enviarDe =
    (de: string): SignalSender =>
    (sinal) => {
      enviados.push({ de, sinal });
      if (derrubarDe === de) return;
      for (const [chave, t] of transportes) {
        if (chave === de) continue;
        if (sinal.to && sinal.to !== chave) continue;
        setTimeout(() => void t.handleSignal({ ...sinal, from: de }), 0);
      }
    };

  transportes.set(A, new PeerToPeerTransport(A, enviarDe(A), ev[A]));
  transportes.set(B, new PeerToPeerTransport(B, enviarDe(B), ev[B]));

  return {
    a: transportes.get(A)!,
    b: transportes.get(B)!,
    ev,
    enviados,
    /** Faz um lado parar de entregar sinais (simula perda). */
    perderSinaisDe: (de: string | null) => (derrubarDe = de),
  };
}

const pcs = () => FakePeerConnection.instances;

let desfazer: () => void;
beforeEach(() => {
  desfazer = installFakeWebRtc();
});
afterEach(() => {
  vi.useRealTimers();
  desfazer();
});

describe('negociacao entre dois peers', () => {
  it('conecta, troca audio e termina com as duas pontas estaveis', async () => {
    const s = sala();
    await s.a.connect(CANAL, faixa('audio'));
    await assentar();
    await s.b.connect(CANAL, faixa('audio'));
    await assentar();

    expect(pcs()).toHaveLength(2);
    for (const pc of pcs()) {
      expect(pc.signalingState).toBe('stable');
      expect(pc.connectionState).toBe('connected');
    }
    expect(s.ev[A].onAudio).toHaveBeenCalledWith(B, expect.anything());
    expect(s.ev[B].onAudio).toHaveBeenCalledWith(A, expect.anything());
    expect(s.a.peerKeys()).toEqual([B]);
    expect(s.b.peerKeys()).toEqual([A]);
  });

  it('resolve colisao de offers (perfect negotiation): o polite cede, ninguem trava', async () => {
    const s = sala();
    // Os dois entram ao mesmo tempo: ambos criam a conexao e mandam offer.
    await Promise.all([s.a.connect(CANAL, faixa('audio')), s.b.connect(CANAL, faixa('audio'))]);
    await assentar(60);

    const offers = s.enviados.filter((e) => e.sinal.kind === 'offer');
    expect(new Set(offers.map((o) => o.de))).toEqual(new Set([A, B]));

    for (const pc of pcs()) {
      expect(pc.signalingState).toBe('stable');
      expect(pc.connectionState).toBe('connected');
    }
    expect(s.ev[A].onAudio).toHaveBeenCalledWith(B, expect.anything());
    expect(s.ev[B].onAudio).toHaveBeenCalledWith(A, expect.anything());
  });

  it('SDP enviado ja vem com Opus de baixa latencia', async () => {
    const s = sala();
    await s.a.connect(CANAL, faixa('audio'));
    await s.b.connect(CANAL, faixa('audio'));
    await assentar();

    const offer = s.enviados.find((e) => e.sinal.kind === 'offer')!.sinal.data as { sdp: string };
    expect(offer.sdp).toContain('a=ptime:10');
    expect(offer.sdp).toMatch(/a=fmtp:111 [^\r]*usedtx=0/);
  });

  it('aplica bitrate e prioridade alta na voz', async () => {
    const s = sala();
    await s.a.connect(CANAL, faixa('audio'));
    await s.b.connect(CANAL, faixa('audio'));
    await assentar();

    const mic = pcs()[0].transceivers[0] as FakeTransceiver;
    const params = mic.sender.setParametersCalls.at(-1)!;
    expect(params.encodings[0].maxBitrate).toBe(64_000);
    expect(params.encodings[0].priority).toBe('high');
  });
});

describe('robustez da sinalizacao', () => {
  function sozinho() {
    const enviados: Sinal[] = [];
    const ev = eventos();
    const t = new PeerToPeerTransport(B, (s) => enviados.push(s), ev);
    return { t, enviados, ev };
  }

  it('ignora sinais de outro canal e os proprios ecos', async () => {
    const { t } = sozinho();
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: 'outro-canal' });
    await t.handleSignal({ kind: 'join', from: B, channelId: CANAL });
    await assentar();
    expect(pcs()).toHaveLength(0);
  });

  it('guarda candidates que chegam antes da offer e aplica depois, na ordem', async () => {
    const { t, enviados } = sozinho();
    await t.connect(CANAL, faixa('audio'));
    // Sem await entre eles: chegam "juntos", como acontece na rede.
    void t.handleSignal({ kind: 'ice', from: A, channelId: CANAL, data: { candidate: 'c1' } });
    void t.handleSignal({ kind: 'ice', from: A, channelId: CANAL, data: { candidate: 'c2' } });
    void t.handleSignal({
      kind: 'offer',
      from: A,
      channelId: CANAL,
      data: { type: 'offer', sdp: 'v=0' },
    });
    await assentar();

    const pc = pcs()[0];
    expect(pc.candidates.map((c) => c.candidate)).toEqual(['c1', 'c2']);
    expect(enviados.filter((s) => s.kind === 'answer')).toHaveLength(1);
  });

  it('lado impolite ignora offer em colisao e descarta os candidates dela sem erro', async () => {
    const { t, enviados } = sozinho(); // B: impolite diante de A
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: CANAL });
    await assentar(); // B ja mandou a propria offer: have-local-offer

    const pc = pcs()[0];
    expect(pc.signalingState).toBe('have-local-offer');
    void t.handleSignal({
      kind: 'offer',
      from: A,
      channelId: CANAL,
      data: { type: 'offer', sdp: 'v=0' },
    });
    void t.handleSignal({ kind: 'ice', from: A, channelId: CANAL, data: { candidate: 'x' } });
    await assentar();

    expect(pc.signalingState).toBe('have-local-offer');
    expect(pc.candidates).toHaveLength(0);
    expect(enviados.filter((s) => s.kind === 'answer')).toHaveLength(0);
  });

  it('offer sem SDP e ignorada e uma falha nao trava a fila do peer', async () => {
    const { t, enviados } = sozinho();
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'offer', from: A, channelId: CANAL, data: null });
    await assentar();
    const pc = pcs()[0];
    pc.signalingState = 'stable';

    pc.failNextRemote = true;
    void t.handleSignal({
      kind: 'offer',
      from: A,
      channelId: CANAL,
      data: { type: 'offer', sdp: 'v=0' },
    });
    // Depois da falha a fila precisa continuar andando.
    void t.handleSignal({
      kind: 'offer',
      from: A,
      channelId: CANAL,
      data: { type: 'offer', sdp: 'v=0' },
    });
    await assentar();
    expect(enviados.filter((s) => s.kind === 'answer')).toHaveLength(1);
  });

  it('leave fecha a conexao, avisa a interface e nao espera a fila', async () => {
    const { t, ev } = sozinho();
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: CANAL });
    await t.handleSignal({ kind: 'leave', from: A, channelId: CANAL });

    expect(pcs()[0].closed).toBe(true);
    expect(ev.onPeerLeft).toHaveBeenCalledWith(A);
    expect(t.peerKeys()).toEqual([]);
  });

  it('disconnect avisa os peers e fecha tudo', async () => {
    const { t, enviados } = sozinho();
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: CANAL });
    await t.disconnect();

    expect(enviados.at(-1)).toEqual({ kind: 'leave', channelId: CANAL });
    expect(pcs()[0].closed).toBe(true);
    expect(t.peerKeys()).toEqual([]);
  });
});

describe('compartilhamento de tela', () => {
  async function conectados() {
    const s = sala();
    await s.a.connect(CANAL, faixa('audio'));
    await assentar();
    await s.b.connect(CANAL, faixa('audio'));
    await assentar();
    return s;
  }

  it('tela chega do outro lado, para com o sinal state e o transceiver e reaproveitado', async () => {
    const s = await conectados();
    const opcoes = {
      maxBitrate: 4_000_000,
      maxFramerate: 60,
      degradationPreference: 'maintain-framerate' as const,
    };

    await s.a.addVideoTrack(faixa('video'), opcoes);
    await assentar();
    expect(s.ev[B].onScreen).toHaveBeenCalledWith(A, expect.anything());
    expect(s.ev[B].onScreen.mock.lastCall?.[1]).not.toBeNull();

    const pcA = pcs().find((pc) => pc.transceivers.some((t) => t.kind === 'video'))!;
    const video = pcA.transceivers.find((t) => t.kind === 'video')!;
    expect(video.sender.setParametersCalls.at(-1)?.encodings[0]).toMatchObject({
      maxBitrate: 4_000_000,
      maxFramerate: 60,
    });

    await s.a.removeVideoTrack();
    await assentar();
    expect(s.ev[B].onScreen).toHaveBeenLastCalledWith(A, null);

    const antes = pcA.transceivers.length;
    await s.a.addVideoTrack(faixa('video'));
    await assentar();
    expect(pcA.transceivers.length).toBe(antes);
    expect(video.direction).toBe('sendonly');
  });

  it('prefere AV1 > VP9 > VP8 > H264 para conteudo de tela', async () => {
    const s = await conectados();
    await s.a.addVideoTrack(faixa('video'));
    await assentar();
    const video = pcs()
      .flatMap((pc) => pc.transceivers)
      .find((t) => t.kind === 'video')!;
    expect(video.codecPreferences?.map((c) => c.mimeType).slice(0, 4)).toEqual([
      'video/AV1',
      'video/VP9',
      'video/VP8',
      'video/H264',
    ]);
  });

  it('quem chega depois descobre que ja ha uma tela sendo transmitida', async () => {
    const enviados: Sinal[] = [];
    const t = new PeerToPeerTransport(A, (s) => enviados.push(s), eventos());
    await t.connect(CANAL, faixa('audio'));
    await t.addVideoTrack(faixa('video'));
    await t.handleSignal({ kind: 'join', from: B, channelId: CANAL });
    await assentar();

    expect(enviados).toContainEqual({
      kind: 'state',
      to: B,
      channelId: CANAL,
      data: { sharing: true },
    });
  });

  it('pede a tela de novo se o aviso chegou e a imagem nao em 5s', async () => {
    vi.useFakeTimers();
    const enviados: Sinal[] = [];
    const t = new PeerToPeerTransport(B, (s) => enviados.push(s), eventos());
    await t.connect(CANAL, faixa('audio'));
    void t.handleSignal({ kind: 'state', from: A, channelId: CANAL, data: { sharing: true } });
    await vi.advanceTimersByTimeAsync(4_900);
    expect(enviados.some((s) => s.kind === 'state' && s.to === A)).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    expect(enviados).toContainEqual({
      kind: 'state',
      to: A,
      channelId: CANAL,
      data: { resend: true },
    });
  });

  it('pedido de reenvio refaz a offer com reinicio de ICE', async () => {
    const enviados: Sinal[] = [];
    const t = new PeerToPeerTransport(A, (s) => enviados.push(s), eventos());
    await t.connect(CANAL, faixa('audio'));
    await t.addVideoTrack(faixa('video'));
    await t.handleSignal({ kind: 'join', from: B, channelId: CANAL });
    await assentar();
    const pc = pcs()[0];
    pc.signalingState = 'stable';

    await t.handleSignal({ kind: 'state', from: B, channelId: CANAL, data: { resend: true } });
    await assentar();
    expect(pc.offerOptions.at(-1)).toEqual({ iceRestart: true });
  });

  it('repassa pausa da transmissao para a interface', async () => {
    const ev = eventos();
    const t = new PeerToPeerTransport(B, () => undefined, ev);
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'state', from: A, channelId: CANAL, data: { paused: true } });
    await assentar();
    expect(ev.onScreenPaused).toHaveBeenCalledWith(A, true);
  });
});

describe('recuperacao de conexao', () => {
  async function umPeer() {
    const t = new PeerToPeerTransport(B, () => undefined, eventos());
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: CANAL });
    return { t, pc: pcs()[0] };
  }

  it('disconnected por mais de 4s forca reinicio de ICE', async () => {
    vi.useFakeTimers();
    const { pc } = await umPeer();
    pc.setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(3_900);
    expect(pc.restartIceCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(pc.restartIceCalls).toBe(1);
  });

  it('se a conexao volta sozinha antes do prazo, nada e reiniciado', async () => {
    vi.useFakeTimers();
    const { pc } = await umPeer();
    pc.setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(2_000);
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pc.restartIceCalls).toBe(0);
  });

  it('failed reinicia o ICE na hora', async () => {
    const { pc } = await umPeer();
    pc.setConnectionState('failed');
    expect(pc.restartIceCalls).toBe(1);
  });

  it('reconectar manualmente reinicia todos e reanuncia presenca', async () => {
    const enviados: Sinal[] = [];
    const t = new PeerToPeerTransport(B, (s) => enviados.push(s), eventos());
    await t.connect(CANAL, faixa('audio'));
    await t.handleSignal({ kind: 'join', from: A, channelId: CANAL });
    await t.reconnectAll();
    expect(pcs()[0].restartIceCalls).toBe(1);
    expect(enviados.at(-1)).toEqual({ kind: 'join', channelId: CANAL });
  });
});
