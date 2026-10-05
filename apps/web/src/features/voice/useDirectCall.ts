import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, AudioEngineState } from './audio/AudioEngine';
import { RemoteAudioMixer, VOLUME_MAXIMO } from './audio/RemoteAudioMixer';
import { sounds } from './audio/SoundEffects';
import { PeerToPeerTransport } from './transport/PeerToPeerTransport';
import { LATENCY_PROFILES } from './transport/lowLatency';
import { ScreenShareEngine, CaptureInfo, CaptureSource } from '../screenshare/ScreenShareEngine';
import { ScreenQuality } from '../screenshare/presets';

/**
 * Chamada direta, sem servidor: liga para um amigo especifico.
 *
 * Reaproveita a mesma malha WebRTC das chamadas de canal (PeerToPeerTransport,
 * AudioEngine, RemoteAudioMixer) - o que muda e so a sinalizacao, que aqui vai
 * pelo topico pessoal de cada um (calls.invite/respond/signal/end) em vez de
 * ser cifrada com a chave de um servidor. E por isso que o transporte nunca
 * soube o que era um "servidor" para comecar: ele so pede um par (sender,
 * eventos) e uma faixa de audio.
 */

export type DirectCallPhase =
  'idle' | 'ringing-out' | 'ringing-in' | 'connecting' | 'active' | 'ended';

export interface DirectCallState {
  phase: DirectCallPhase;
  callId: string | null;
  peerKey: string | null;
  peerName: string;
  peerAvatar: string | null;
  muted: boolean;
  deafened: boolean;
  connection: RTCPeerConnectionState | null;
  /** O outro lado esta falando agora. */
  peerSpeaking: boolean;
  audio: AudioEngineState | null;
  error: string | null;
  screenSharing: boolean;
  screenPaused: boolean;
  capture: CaptureInfo | null;
  remoteScreen: MediaStream | null;
  localScreen: MediaStream | null;
  joinedAt: number | null;
  /** Motivo de ter terminado - "recusou", "sem resposta", "encerrou" etc. */
  endReason: string | null;
}

const ESTADO_INICIAL: DirectCallState = {
  phase: 'idle',
  callId: null,
  peerKey: null,
  peerName: '',
  peerAvatar: null,
  muted: false,
  deafened: false,
  connection: null,
  peerSpeaking: false,
  audio: null,
  error: null,
  screenSharing: false,
  screenPaused: false,
  capture: null,
  remoteScreen: null,
  localScreen: null,
  joinedAt: null,
  endReason: null,
};

/** Toca ate ser atendida ou recusada; depois disso, desiste sozinha. */
const TEMPO_TOCANDO_MS = 45_000;

export function useDirectCall(selfKey: string, ocupado: () => boolean) {
  const [state, setState] = useState<DirectCallState>(ESTADO_INICIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const engineRef = useRef<AudioEngine | null>(null);
  const transportRef = useRef<PeerToPeerTransport | null>(null);
  const mixerRef = useRef(new RemoteAudioMixer());
  const screenRef = useRef(new ScreenShareEngine());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpar = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    void screenRef.current.stop();
    void transportRef.current?.disconnect();
    void engineRef.current?.stop();
    transportRef.current = null;
    engineRef.current = null;
    mixerRef.current.stop();
  }, []);

  /** Encerra e volta para o repouso, guardando o motivo por um instante. */
  const finalizar = useCallback(
    (endReason: string | null) => {
      limpar();
      setState((s) => ({ ...ESTADO_INICIAL, endReason: endReason ?? s.endReason }));
    },
    [limpar],
  );

  /** Cria o motor de audio e o transporte, e conecta. Comum a quem liga e a quem atende. */
  const iniciarMidia = useCallback(
    async (peerKey: string, callId: string) => {
      const perfil = LATENCY_PROFILES.ultra;
      const engine = new AudioEngine({
        transmitMode: 'voice-activity',
        eqPreset: 'voice',
        useCompressor: perfil.useCompressor,
        vad: { attackMs: perfil.vadAttackMs },
      });
      await engine.start();
      engine.subscribe((audio) => setState((s) => ({ ...s, audio })));
      engineRef.current = engine;

      const track = engine.getProcessedTrack();
      if (!track) throw new Error('Nao foi possivel obter a faixa de audio processada');

      let ultimaFala = 0;
      const transport = new PeerToPeerTransport(
        selfKey,
        (signal) => void window.concord.calls.signal(peerKey, signal),
        {
          onAudio: (_peerKey, stream) => {
            mixerRef.current.attach(peerKey, stream);
          },
          onScreen: (_peerKey, stream) => {
            setState((s) => ({ ...s, remoteScreen: stream }));
          },
          onScreenPaused: (_peerKey, paused) => {
            setState((s) => ({ ...s, screenPaused: paused }));
          },
          onPeerLeft: () => finalizar('a pessoa encerrou'),
          onConnectionChange: (_peerKey, connection) => {
            setState((s) => ({ ...s, connection }));
          },
        },
      );
      transportRef.current = transport;
      transport.setLatencyProfile(perfil);
      await transport.connect(callId, track);

      // Nivel de audio remoto -> ring de "esta falando", mesma logica das calls de canal.
      const LIMIAR = 0.02;
      const HISTERESE_MS = 300;
      const nivelId = setInterval(() => {
        const nivel = transport.audioLevels().get(peerKey) ?? 0;
        if (nivel >= LIMIAR) ultimaFala = Date.now();
        const falando = Date.now() - ultimaFala < HISTERESE_MS;
        setState((s) => (s.peerSpeaking === falando ? s : { ...s, peerSpeaking: falando }));
      }, 150);
      // Guardado no proprio timeout ref de limpeza generica via disconnect: como
      // nao ha um "peers.clear" aqui (so existe 1 peer), o intervalo e limpo
      // junto do transporte ao desconectar.
      const disconnectOriginal = transport.disconnect.bind(transport);
      transport.disconnect = async () => {
        clearInterval(nivelId);
        await disconnectOriginal();
      };

      void window.concord.settings.setCallActive(true).catch(() => undefined);
      void window.concord.presence.setVoiceChannel(`dm:${callId}`).catch(() => undefined);
      setState((s) => ({ ...s, phase: 'active', connection: 'new', joinedAt: Date.now() }));
    },
    [selfKey, finalizar],
  );

  /** Liga para um amigo. Nao pede microfone ainda - so depois que ele aceitar. */
  const call = useCallback(
    async (peerKey: string, peerName: string, peerAvatar: string | null) => {
      if (ocupado() || stateRef.current.phase !== 'idle') return;

      const callId = crypto.randomUUID();
      setState({
        ...ESTADO_INICIAL,
        phase: 'ringing-out',
        callId,
        peerKey,
        peerName,
        peerAvatar,
      });

      try {
        const status = await window.concord.calls.invite(peerKey, callId);
        if (status === 'na-fila') {
          // Nao ha como saber se algum dia ela vai ver: o convite fica na fila
          // exatamente como um pedido de amizade offline.
          setState((s) =>
            s.callId === callId
              ? { ...s, error: 'Ela esta offline agora - o convite espera na fila dela.' }
              : s,
          );
        }
        sounds.play('join');
      } catch (e) {
        finalizar(e instanceof Error ? e.message : 'Nao foi possivel ligar');
        return;
      }

      timeoutRef.current = setTimeout(() => {
        if (stateRef.current.callId !== callId || stateRef.current.phase !== 'ringing-out') return;
        void window.concord.calls.end(peerKey, callId).catch(() => undefined);
        finalizar('sem resposta');
      }, TEMPO_TOCANDO_MS);
    },
    [ocupado, finalizar],
  );

  /** Atende a chamada que esta tocando. */
  const accept = useCallback(async () => {
    const { callId, peerKey } = stateRef.current;
    if (!callId || !peerKey || stateRef.current.phase !== 'ringing-in') return;

    setState((s) => ({ ...s, phase: 'connecting' }));
    void window.concord.calls.respond(peerKey, callId, true).catch(() => undefined);

    try {
      await iniciarMidia(peerKey, callId);
      sounds.play('join');
    } catch (e) {
      void window.concord.calls.end(peerKey, callId).catch(() => undefined);
      finalizar(e instanceof Error ? e.message : 'Nao foi possivel atender');
    }
  }, [iniciarMidia, finalizar]);

  /** Recusa a chamada que esta tocando. */
  const decline = useCallback(() => {
    const { callId, peerKey } = stateRef.current;
    if (callId && peerKey)
      void window.concord.calls.respond(peerKey, callId, false).catch(() => undefined);
    finalizar(null);
  }, [finalizar]);

  /** Encerra em qualquer fase - desiste de ligar, desliga ou sai da ativa. */
  const hangUp = useCallback(() => {
    const { callId, peerKey } = stateRef.current;
    if (callId && peerKey) void window.concord.calls.end(peerKey, callId).catch(() => undefined);
    sounds.play('leave');
    void window.concord.settings.setCallActive(false).catch(() => undefined);
    void window.concord.presence.setVoiceChannel(null).catch(() => undefined);
    finalizar(null);
  }, [finalizar]);

  // Convite recebido, resposta do outro lado e encerramento remoto - tudo
  // chega pelo mesmo canal social que ja alimenta pedidos de amizade.
  useEffect(() => {
    return window.concord.onSocialEvent((evento, dados) => {
      const d = dados as {
        from: string;
        callId: string;
        displayName?: string;
        avatar?: string | null;
      };

      if (evento === 'call:invite') {
        // Ja em outra chamada (de servidor ou direta): recusa educadamente sem
        // nem mostrar o popup, para nao interromper quem esta ocupado.
        if (ocupado() || stateRef.current.phase !== 'idle') {
          void window.concord.calls.respond(d.from, d.callId, false).catch(() => undefined);
          return;
        }
        sounds.play('peerJoin');
        setState({
          ...ESTADO_INICIAL,
          phase: 'ringing-in',
          callId: d.callId,
          peerKey: d.from,
          peerName: d.displayName || d.from.slice(0, 8),
          peerAvatar: d.avatar ?? null,
        });
        return;
      }

      if (d.callId !== stateRef.current.callId || d.from !== stateRef.current.peerKey) return;

      if (evento === 'call:accept' && stateRef.current.phase === 'ringing-out') {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setState((s) => ({ ...s, phase: 'connecting' }));
        void iniciarMidia(d.from, d.callId).catch((e) => {
          void window.concord.calls.end(d.from, d.callId).catch(() => undefined);
          finalizar(e instanceof Error ? e.message : 'Nao foi possivel conectar');
        });
      } else if (evento === 'call:decline') {
        finalizar('ela recusou');
      } else if (evento === 'call:end') {
        if (stateRef.current.phase !== 'idle') finalizar('a pessoa encerrou');
      }
    });
  }, [iniciarMidia, finalizar, ocupado]);

  // Sinalizacao WebRTC da chamada ativa.
  useEffect(() => {
    return window.concord.calls.onSignal((callId, signal) => {
      if (callId !== stateRef.current.callId) return;
      void transportRef.current?.handleSignal(signal);
    });
  }, []);

  const toggleMute = useCallback(() => {
    setState((s) => {
      const muted = !s.muted;
      engineRef.current?.setTransmitMode(muted ? 'push-to-talk' : 'voice-activity');
      if (muted) engineRef.current?.setPushToTalk(false);
      sounds.play(muted ? 'mute' : 'unmute');
      return { ...s, muted };
    });
  }, []);

  const toggleDeafen = useCallback(() => {
    setState((s) => {
      const deafened = !s.deafened;
      mixerRef.current.setDeafened(deafened);
      sounds.play(deafened ? 'deafen' : 'unmute');
      return { ...s, deafened };
    });
  }, []);

  const startScreenShare = useCallback(async (source: CaptureSource, quality: ScreenQuality) => {
    const transport = transportRef.current;
    if (!transport) return;
    try {
      const track = await screenRef.current.start(source, quality);
      await transport.addVideoTrack(track, {
        maxBitrate: quality.maxBitrate,
        maxFramerate: quality.frameRate,
        degradationPreference: quality.degradation,
      });
      sounds.play('screenStart');
      setState((s) => ({
        ...s,
        screenSharing: true,
        screenPaused: false,
        capture: screenRef.current.getCaptureInfo(),
        localScreen: new MediaStream([track]),
      }));
      screenRef.current.onEnded(() => void stopScreenShare());
    } catch (e) {
      sounds.play('error');
      await screenRef.current.stop();
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : 'Nao foi possivel compartilhar a tela',
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScreenShare = useCallback(async () => {
    if (!screenRef.current.isActive()) return;
    await transportRef.current?.removeVideoTrack();
    await screenRef.current.stop();
    sounds.play('screenStop');
    setState((s) => ({
      ...s,
      screenSharing: false,
      screenPaused: false,
      capture: null,
      localScreen: null,
    }));
  }, []);

  useEffect(() => () => limpar(), [limpar]);

  return {
    state,
    call,
    accept,
    decline,
    hangUp,
    toggleMute,
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
    peerVolume: () => (state.peerKey ? mixerRef.current.volumeDe(state.peerKey) : 1),
    setPeerVolume: (volume: number) => {
      if (state.peerKey)
        mixerRef.current.setVolume(state.peerKey, Math.min(VOLUME_MAXIMO, Math.max(0, volume)));
    },
  };
}
