import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, AudioEngineState, TransmitMode } from './audio/AudioEngine';
import { sounds } from './audio/SoundEffects';
import { PeerToPeerTransport } from './transport/PeerToPeerTransport';
import { ScreenStats, VoiceStats } from './transport/VoiceTransport';
import { LATENCY_PROFILES, LatencyBreakdown, LatencyProfile } from './transport/lowLatency';
import { ScreenShareEngine, CaptureInfo, CaptureSource } from '../screenshare/ScreenShareEngine';
import { ScreenQuality } from '../screenshare/presets';

export interface CallParticipant {
  key: string;
  name: string;
  connection: RTCPeerConnectionState;
  stats: VoiceStats | null;
  latency: LatencyBreakdown | null;
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
  screenSharing: boolean;
  screenPaused: boolean;
  capture: CaptureInfo | null;
  screenStats: ScreenStats | null;
  /** Stream da propria tela, para o preview de quem transmite. */
  localScreen: MediaStream | null;
  latencyProfile: LatencyProfile['id'];
  graphLatencyMs: number | null;
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
  screenSharing: false,
  screenPaused: false,
  capture: null,
  screenStats: null,
  localScreen: null,
  latencyProfile: 'ultra',
  graphLatencyMs: null,
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
  const videoElements = useRef(new Map<string, MediaStream>());
  const screenRef = useRef(new ScreenShareEngine());
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
          latency: anterior?.latency ?? null,
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

  /**
   * Separa tracks de audio e video do stream remoto.
   * Audio vai para elementos <audio> (invisíveis); video e guardado no Map
   * de streams para renderizar no ScreenShareOverlay.
   */
  const anexarStream = useCallback((peerKey: string, stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    if (audioTracks.length > 0) {
      let element = audioElements.current.get(peerKey);
      if (!element) {
        element = new Audio();
        element.autoplay = true;
        audioElements.current.set(peerKey, element);
      }
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    }

    if (videoTracks.length > 0) {
      videoElements.current.set(peerKey, stream);
      // Forca re-render para atualizar remoteScreens.
      setState((s) => ({ ...s }));
    }
  }, []);

  const desanexarAudio = useCallback((peerKey: string) => {
    const element = audioElements.current.get(peerKey);
    if (element) {
      element.srcObject = null;
      audioElements.current.delete(peerKey);
    }
    videoElements.current.delete(peerKey);
    setState((s) => ({ ...s }));
  }, []);

  const leave = useCallback(async () => {
    // Para o screen share antes de sair.
    await screenRef.current.stop();
    await transportRef.current?.disconnect();
    await engineRef.current?.stop();
    transportRef.current = null;
    engineRef.current = null;
    for (const key of [...audioElements.current.keys()]) desanexarAudio(key);
    videoElements.current.clear();
    sounds.play('leave');
    setState(ESTADO_INICIAL);
  }, [desanexarAudio]);

  const join = useCallback(
    async (channelId: string, channelName: string, selfKey: string) => {
      if (!serverIdRef.current) return;
      if (transportRef.current) await leave();

      setState({ ...ESTADO_INICIAL, channelId, channelName, connecting: true });

      try {
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

        const transport = new PeerToPeerTransport(
          selfKey,
          (signal) => {
            const sid = serverIdRef.current;
            if (sid) void window.concord.voice.signal(sid, signal);
          },
          {
            onStream: (peerKey, stream) => {
              anexarStream(peerKey, stream);
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
                  : [
                      ...s.participants,
                      { key: peerKey, name: nomeDe(peerKey), connection, stats: null, latency: null },
                    ],
              }));
            },
          },
        );
        transportRef.current = transport;

        transport.setLatencyProfile(perfil);
        await transport.connect(channelId, track);
        sounds.play('join');
        setState((s) => ({
          ...s,
          connecting: false,
          graphLatencyMs: engine.getGraphLatencyMs(),
        }));
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
      const [stats, latency] = await Promise.all([transport.getStats(), transport.getLatency()]);
      setState((s) => ({
        ...s,
        participants: s.participants.map((p) => ({
          ...p,
          stats: stats.get(p.key) ?? p.stats,
          latency: latency.get(p.key) ?? p.latency,
        })),
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

  /** Inicia a transmissao com a fonte e a qualidade escolhidas no seletor. */
  const startScreenShare = useCallback(
    async (source: CaptureSource, quality: ScreenQuality) => {
      const transport = transportRef.current;
      if (!transport) return;

      try {
        const track = await screenRef.current.start(source, quality);
        await transport.addVideoTrack(track, {
          maxBitrate: quality.maxBitrate,
          maxFramerate: quality.frameRate,
          degradationPreference: quality.degradation,
        });

        const audio = screenRef.current.getAudioTrack();
        if (audio) await transport.addSystemAudioTrack(audio);

        sounds.play('success');
        setState((s) => ({
          ...s,
          screenSharing: true,
          screenPaused: false,
          capture: screenRef.current.getCaptureInfo(),
          // Preview do proprio compartilhamento: e so a track local, entao nao
          // custa banda nenhuma.
          localScreen: new MediaStream([track]),
        }));

        // O usuario pode encerrar pela barra do proprio sistema.
        screenRef.current.onEnded(() => void stopScreenShare());
      } catch (error) {
        sounds.play('error');
        await screenRef.current.stop();
        setState((s) => ({
          ...s,
          error:
            error instanceof Error
              ? `Nao foi possivel compartilhar: ${error.message}`
              : 'Nao foi possivel compartilhar a tela',
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stopScreenShare = useCallback(async () => {
    if (!screenRef.current.isActive()) return;
    await transportRef.current?.removeVideoTrack();
    await transportRef.current?.removeSystemAudioTrack();
    await screenRef.current.stop();
    sounds.play('leave');
    setState((s) => ({
      ...s,
      screenSharing: false,
      screenPaused: false,
      capture: null,
      screenStats: null,
      localScreen: null,
    }));
  }, []);

  /** Congela a imagem sem derrubar a conexao. */
  const toggleScreenPause = useCallback(async () => {
    const engine = screenRef.current;
    if (!engine.isActive()) return;

    const track = engine.isPaused() ? engine.resume() : await engine.pause();
    if (track) await transportRef.current?.replaceVideoTrack(track);

    sounds.play(engine.isPaused() ? 'mute' : 'unmute');
    setState((s) => ({ ...s, screenPaused: engine.isPaused() }));
  }, []);

  /** Troca a fonte transmitida sem interromper quem esta assistindo. */
  const switchScreenSource = useCallback(
    async (source: CaptureSource, quality: ScreenQuality) => {
      const transport = transportRef.current;
      if (!transport || !screenRef.current.isActive()) return;

      const antigaComAudio = screenRef.current.getAudioTrack() !== null;
      const track = await screenRef.current.start(source, quality);
      await transport.replaceVideoTrack(track);
      await transport.setVideoEncoding({
        maxBitrate: quality.maxBitrate,
        maxFramerate: quality.frameRate,
        degradationPreference: quality.degradation,
      });

      if (antigaComAudio) await transport.removeSystemAudioTrack();
      const audio = screenRef.current.getAudioTrack();
      if (audio) await transport.addSystemAudioTrack(audio);

      screenRef.current.onEnded(() => void stopScreenShare());
      setState((s) => ({
        ...s,
        capture: screenRef.current.getCaptureInfo(),
        localScreen: new MediaStream([track]),
      }));
    },
    [stopScreenShare],
  );

  /** Ajusta qualidade durante a transmissao, sem reabrir a fonte. */
  const applyScreenQuality = useCallback(async (quality: ScreenQuality) => {
    await screenRef.current.applyQuality(quality);
    await transportRef.current?.setVideoEncoding({
      maxBitrate: quality.maxBitrate,
      maxFramerate: quality.frameRate,
      degradationPreference: quality.degradation,
    });
    setState((s) => ({ ...s, capture: screenRef.current.getCaptureInfo() }));
  }, []);

  // Metricas do que estamos transmitindo.
  useEffect(() => {
    if (!state.screenSharing) return;
    const id = setInterval(async () => {
      const screenStats = await transportRef.current?.getOutboundVideoStats();
      if (screenStats) setState((s) => ({ ...s, screenStats }));
    }, 2000);
    return () => clearInterval(id);
  }, [state.screenSharing]);

  useEffect(() => {
    return () => {
      void transportRef.current?.disconnect();
      void engineRef.current?.stop();
      void screenRef.current.stop();
    };
  }, []);

  /** Streams de video remotos ativos (peers compartilhando a tela). */
  const remoteScreens = new Map(videoElements.current);

  return {
    state,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    setTransmitMode,
    startScreenShare,
    stopScreenShare,
    toggleScreenPause,
    switchScreenSource,
    applyScreenQuality,
    remoteScreens,
  };
}
