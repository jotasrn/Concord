import { describe, expect, it } from 'vitest';
import { OPUS_BITRATE_BPS, applyOpusLowLatency, readLatency, tuneReceiver } from './lowLatency';

const SDP_CHROMIUM = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 109 0',
  'a=rtpmap:109 opus/48000/2',
  'a=fmtp:109 minptime=10;useinbandfec=1;x-google-extra=1',
  'a=rtpmap:0 PCMU/8000',
].join('\r\n');

describe('applyOpusLowLatency', () => {
  it('descobre o payload do Opus em vez de assumir 111', () => {
    const sdp = applyOpusLowLatency(SDP_CHROMIUM, 10);
    expect(sdp).toMatch(/^a=fmtp:109 minptime=10;useinbandfec=1;usedtx=0;/m);
    expect(sdp).not.toContain('a=fmtp:111');
  });

  it('pede ptime logo apos o rtpmap e limita maxptime a no minimo 20', () => {
    const linhas = applyOpusLowLatency(SDP_CHROMIUM, 10).split('\r\n');
    const i = linhas.indexOf('a=rtpmap:109 opus/48000/2');
    expect(linhas.slice(i + 1, i + 3)).toEqual(['a=ptime:10', 'a=maxptime:20']);
    expect(applyOpusLowLatency(SDP_CHROMIUM, 40)).toContain('a=maxptime:40');
  });

  it('fixa mono, bitrate e VBR sem duplicar parametros e preserva os desconhecidos', () => {
    const fmtp = applyOpusLowLatency(SDP_CHROMIUM, 10)
      .split('\r\n')
      .find((l) => l.startsWith('a=fmtp:109'))!;
    expect(fmtp).toContain(`maxaveragebitrate=${OPUS_BITRATE_BPS}`);
    expect(fmtp).toContain('stereo=0');
    expect(fmtp).toContain('cbr=0');
    expect(fmtp).toContain('x-google-extra=1');
    expect(fmtp.match(/useinbandfec=/g)).toHaveLength(1);
    expect(fmtp.match(/minptime=/g)).toHaveLength(1);
  });

  it('cria a linha fmtp quando ela nao existe', () => {
    const sdp = ['v=0', 'm=audio 9 RTP 96', 'a=rtpmap:96 opus/48000/2'].join('\r\n');
    const linhas = applyOpusLowLatency(sdp, 10).split('\r\n');
    expect(linhas[3]).toMatch(/^a=fmtp:96 minptime=10;/);
  });

  it('nao mexe em SDP sem Opus', () => {
    const sdp = 'v=0\r\nm=video 9 RTP 96\r\na=rtpmap:96 VP9/90000';
    expect(applyOpusLowLatency(sdp, 10)).toBe(sdp);
  });
});

describe('readLatency', () => {
  const relatorio = (entradas: Record<string, unknown>[]) =>
    new Map(entradas.map((e, i) => [String(i), e])) as unknown as RTCStatsReport;

  it('soma metade do RTT do par nomeado com a media do jitter buffer', () => {
    const r = readLatency(
      relatorio([
        { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.04 },
        { type: 'candidate-pair', state: 'failed', nominated: false, currentRoundTripTime: 9 },
        { type: 'inbound-rtp', kind: 'audio', jitterBufferDelay: 3, jitterBufferEmittedCount: 100 },
        { type: 'inbound-rtp', kind: 'video', jitterBufferDelay: 99, jitterBufferEmittedCount: 1 },
      ]),
    );
    expect(r.networkMs).toBeCloseTo(20);
    expect(r.jitterBufferMs).toBeCloseTo(30);
    expect(r.totalMs).toBeCloseTo(50);
  });

  it('sem metricas devolve null em vez de zero enganoso', () => {
    expect(readLatency(relatorio([]))).toEqual({
      networkMs: null,
      jitterBufferMs: null,
      totalMs: null,
    });
  });
});

describe('tuneReceiver', () => {
  it('aplica o alvo nas duas APIs e tolera navegador que recusa o valor', () => {
    const ok = { jitterBufferTarget: null, playoutDelayHint: null };
    tuneReceiver(ok as unknown as RTCRtpReceiver, 0.12);
    expect(ok).toEqual({ jitterBufferTarget: 0.12, playoutDelayHint: 0.12 });

    const recusa = {
      get jitterBufferTarget() {
        return null;
      },
      set jitterBufferTarget(_v: number | null) {
        throw new RangeError('fora da faixa');
      },
    };
    expect(() => tuneReceiver(recusa as unknown as RTCRtpReceiver, 99)).not.toThrow();
  });
});
