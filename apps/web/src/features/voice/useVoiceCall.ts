import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, AudioEngineState, TransmitMode } from './audio/AudioEngine';
import { sounds } from './audio/SoundEffects';
import { PeerToPeerTransport } from './transport/PeerToPeerTransport';
import { VoiceStats } from './transport/VoiceTransport';

export interface CallParticipant {
  key: string;
  name: string;
  connection: RTCPeerConnectionState;
  stats: VoiceStats | null;
}

export interface CallState {
  channelId: string | null;
  channelName: string | null;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  participants: CallParticipant[];
  audio: AudioEngineState | null;
  error: string | null;
}

const ESTADO_INICIAL: CallState = {
  channelId: null,
  channelName: null,
  connecting: false,
  muted: false,
  deafened: false,
  participants: [],
  audio: null,
  error: null,
};

/**
 * Orquestra uma chamada de voz: captura processada pelo AudioEngine, malha
 * WebRTC pelo PeerToPeerTransport e sinalizacao pela camada P2P do Electron.
 *
 * Os elementos <audio> dos peers sao criados fora do React: recria-los a cada
 * render interromperia a reproducao.
 */
export function useVoiceCall(serverId: string | null, memberNames: Map<string, string>) {
  const [state, setState] = useState<CallState>(ESTADO_INICIAL);
  const engineRef = useRef<AudioEngine | null>(null);
  const transportRef = useRef<PeerToPeerTransport | null>(null);
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const serverIdRef = useRef(serverId);
  serverIdRef.current = serverId;

  const nomeDe = useCallback(
    (key: string) => memberNames.get(key) ?? `${key.slice(0, 8)}...`,
    [memberNames],
  );

  const atualizarParticipantes = useCallback(() => {
    const transport = transportRef.current;
    if (!transport) return;
    setState((s) => ({
      ...s,
      participants: transport.peerKeys().map((key) => {
        const anterior = s.participants.find((p) => p.key === key);
        return {
          key,
          name: nomeDe(key),
          connection: anterior?.connection ?? 'new',
          stats: anterior?.stats ?? null,
        };
      }),
    }));
  }, [nomeDe]);

  const anexarAudio = useCallback((peerKey: string, stream: MediaStream) => {
    let element = audioElements.current.get(peerKey);
    if (!element) {
      element = new Audio();
      element.autoplay = true;
      audioElements.current.set(peerKey, element);
    }
    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, []);

  const desanexarAudio = useCallback((peerKey: string) => {
    const element = audioElements.current.get(peerKey);
    if (element) {
      element.srcObject = null;
      audioElements.current.delete(peerKey);
    }
  }, []);

  const leave = useCallback(async () => {
    await transportRef.current?.disconnect();
    await engineRef.current?.stop();
    transportRef.current = null;
    engineRef.current = null;
    for (const key of [...audioElements.current.keys()]) desanexarAudio(key);
    sounds.play('leave');
    setState(ESTADO_INICIAL);
  }, [desanexarAudio]);

  const join = useCallback(
    async (channelId: string, channelName: string, selfKey: string) => {
      if (!serverIdRef.current) return;
      if (transportRef.current) await leave();

      setState({ ...ESTADO_INICIAL, channelId, channelName, connecting: true });

      try {
        const engine = new AudioEngine({ transmitMode: 'voice-activity', eqPreset: 'voice' });
        await engine.start();
        engine.subscribe((audio) => setState((s) => ({ ...s, audio })));
        engineRef.current = engine;

        const track = engine.getProcessedTrack();
        if (!track) throw new Error('Nao foi possivel obter a faixa de audio processada');

        const transport = new PeerToPeerTransport(
          selfKey,
          (signal) => {
            const sid = serverIdRef.current;
            if (sid) void window.concord.voice.signal(sid, signal);
          },
          {
            onStream: (peerKey, stream) => {
              anexarAudio(peerKey, stream);
              atualizarParticipantes();
            },
            onPeerLeft: (peerKey) => {
              desanexarAudio(peerKey);
              sounds.play('peerLeave');
              atualizarParticipantes();
            },
            onConnectionChange: (peerKey, connection) => {
              if (connection === 'connected') sounds.play('peerJoin');
              setState((s) => ({
                ...s,
                participants: s.participants.some((p) => p.key === peerKey)
                  ? s.participants.map((p) => (p.key === peerKey ? { ...p, connection } : p))
                  : [...s.participants, { key: peerKey, name: nomeDe(peerKey), connection, stats: null }],
              }));
            },
          },
        );
        transportRef.current = transport;

        await transport.connect(channelId, track);
        sounds.play('join');
        setState((s) => ({ ...s, connecting: false }));
      } catch (error) {
        sounds.play('error');
        await engineRef.current?.stop();
        engineRef.current = null;
        setState({
          ...ESTADO_INICIAL,
          error:
            error instanceof Error
              ? `Nao foi possivel entrar na chamada: ${error.message}`
              : 'Nao foi possivel entrar na chamada',
        });
      }
    },
    [anexarAudio, atualizarParticipantes, desanexarAudio, leave, nomeDe],
  );

  // Sinais vindos dos peers.
  useEffect(() => {
    return window.concord.voice.onSignal((sinalServerId, signal) => {
      if (sinalServerId !== serverIdRef.current) return;
      void transportRef.current?.handleSignal(signal);
    });
  }, []);

  // Metricas reais do WebRTC, atualizadas a cada 2s.
  useEffect(() => {
    if (!state.channelId) return;
    const id = setInterval(async () => {
      const transport = transportRef.current;
      if (!transport) return;
      const stats = await transport.getStats();
      setState((s) => ({
        ...s,
        participants: s.participants.map((p) => ({ ...p, stats: stats.get(p.key) ?? p.stats })),
      }));
    }, 2000);
    return () => clearInterval(id);
  }, [state.channelId]);

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
      for (const element of audioElements.current.values()) element.muted = deafened;
      sounds.play(deafened ? 'deafen' : 'unmute');
      return { ...s, deafened };
    });
  }, []);

  const setTransmitMode = useCallback((mode: TransmitMode) => {
    engineRef.current?.setTransmitMode(mode);
  }, []);

  useEffect(() => {
    return () => {
      void transportRef.current?.disconnect();
      void engineRef.current?.stop();
    };
  }, []);

  return { state, join, leave, toggleMute, toggleDeafen, setTransmitMode };
}
