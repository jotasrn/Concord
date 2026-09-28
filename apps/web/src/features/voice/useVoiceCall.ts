import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, AudioEngineState, TransmitMode } from './audio/AudioEngine';
import { RemoteAudioMixer, VOLUME_MAXIMO } from './audio/RemoteAudioMixer';
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
  speaking: boolean;
  muted: boolean;
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
  /** Momento em que a chamada comecou, para contar o tempo em call. */
  joinedAt: number | null;
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
  joinedAt: null,
};

/**
 * Orquestra uma chamada de voz: captura processada pelo AudioEngine, malha
 * WebRTC pelo PeerToPeerTransport e sinalizacao pela camada P2P do Electron.
 *
 * Os elementos <audio> dos peers sao criados fora do React: recria-los a cada
 * render interromperia a reproducao.
 */
export function useVoiceCall(
  serverId: string | null,
  memberNames: Map<string, string>,
  /**
   * Quem esta silenciado pela moderacao.
   *
   * A aplicacao acontece AQUI, em quem recebe: nao existe autoridade central
   * que impeca alguem de transmitir, entao o que garante o silencio e cada
   * cliente honesto nao reproduzir o audio de quem esta na lista.
   */
  mutedKeys: Set<string> = new Set(),
) {
  const [state, setState] = useState<CallState>(ESTADO_INICIAL);
  const stateRef = useRef(state);
  stateRef.current = state;
  const engineRef = useRef<AudioEngine | null>(null);
  const transportRef = useRef<PeerToPeerTransport | null>(null);
  const mixerRef = useRef(new RemoteAudioMixer());
  /**
   * Telas remotas em estado do React, nao em ref.
   *
   * Antes isto era um ref e a lista era recalculada a cada render, entao a
   * chegada de uma tela nova dependia de um render acontecer por outro motivo.
   * Como estado, a tela aparece no instante em que a faixa chega.
   */
  const [remoteScreens, setRemoteScreens] = useState<Map<string, MediaStream>>(new Map());
  /** Volume por pessoa, 1 = original. Espelha o mixer para a UI poder mostrar. */
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  /** Quem congelou a propria transmissao, para a imagem parada ter explicacao. */
  const [peersPausados, setPeersPausados] = useState<Record<string, boolean>>({});
  /** Silenciados so para mim - preferencia pessoal, nao punicao. */
  const [localMutedKeys, setLocalMutedKeys] = useState<Set<string>>(new Set());
  /** Participante fixado no palco. Um so por vez, como no Discord. */
  const [pinned, setPinned] = useState<string | null>(null);
  const screenRef = useRef(new ScreenShareEngine());
  const serverIdRef = useRef(serverId);
  serverIdRef.current = serverId;
  const mutedRef = useRef(mutedKeys);
  mutedRef.current = mutedKeys;

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
          speaking: anterior?.speaking ?? false,
          muted: anterior?.muted ?? mutedRef.current.has(key),
        };
      }),
    }));
  }, [nomeDe]);



  /** Audio de um peer: vai para o mixer, que cuida de volume e silenciamento. */
  const anexarAudio = useCallback((peerKey: string, stream: MediaStream) => {
    const mixer = mixerRef.current;
    mixer.attach(peerKey, stream);
    // Silenciado pela moderacao nao toca, mesmo que continue enviando.
    mixer.setModerationMuted(peerKey, mutedRef.current.has(peerKey));
    setPeerVolumes((v) => (peerKey in v ? v : { ...v, [peerKey]: mixer.volumeDe(peerKey) }));
  }, []);

  /** Tela de um peer, ou null quando ele para de transmitir. */
  const anexarTela = useCallback((peerKey: string, stream: MediaStream | null) => {
    setRemoteScreens((atual) => {
      if (!stream) {
        if (!atual.has(peerKey)) return atual;
        const proximo = new Map(atual);
        proximo.delete(peerKey);
        return proximo;
      }
      if (atual.get(peerKey) === stream) return atual;
      return new Map(atual).set(peerKey, stream);
    });
  }, []);

  const desanexarPeer = useCallback((peerKey: string) => {
    mixerRef.current.detach(peerKey);
    setRemoteScreens((atual) => {
      if (!atual.has(peerKey)) return atual;
      const proximo = new Map(atual);
      proximo.delete(peerKey);
      return proximo;
    });
    // Quem saiu nao pode continuar fixado ou aparecer como silenciado.
    setPinned((atual) => (atual === peerKey ? null : atual));
    setLocalMutedKeys((atual) => {
      if (!atual.has(peerKey)) return atual;
      const proximo = new Set(atual);
      proximo.delete(peerKey);
      return proximo;
    });
  }, []);

  /** Volume de uma pessoa. 1 = original, ate VOLUME_MAXIMO de reforco. */
  const setPeerVolume = useCallback((peerKey: string, volume: number) => {
    const limitado = Math.min(VOLUME_MAXIMO, Math.max(0, volume));
    mixerRef.current.setVolume(peerKey, limitado);
    setPeerVolumes((v) => ({ ...v, [peerKey]: limitado }));
  }, []);

  const leave = useCallback(async () => {
    // Para o screen share antes de sair.
    await screenRef.current.stop();
    await transportRef.current?.disconnect();
    await engineRef.current?.stop();
    transportRef.current = null;
    engineRef.current = null;
    mixerRef.current.stop();
    setRemoteScreens(new Map());
    setPeersPausados({});
    setLocalMutedKeys(new Set());
    setPinned(null);
    void window.concord.presence.setVoiceChannel(null).catch(() => undefined);
    void window.concord.settings.setCallActive(false).catch(() => undefined);
    sounds.play('leave');
    setState(ESTADO_INICIAL);
  }, []);

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
            onAudio: (peerKey, stream) => {
              anexarAudio(peerKey, stream);
              atualizarParticipantes();
            },
            onScreen: (peerKey, stream) => {
              anexarTela(peerKey, stream);
              atualizarParticipantes();
            },
            onScreenPaused: (peerKey, paused) => {
              setPeersPausados((atual) => {
                if (Boolean(atual[peerKey]) === paused) return atual;
                return { ...atual, [peerKey]: paused };
              });
            },
            onPeerLeft: (peerKey) => {
              desanexarPeer(peerKey);
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
                      {
                        key: peerKey,
                        name: nomeDe(peerKey),
                        connection,
                        stats: null,
                        latency: null,
                        speaking: false,
                        muted: mutedRef.current.has(peerKey),
                      },
                    ],
              }));
            },
          },
        );
        transportRef.current = transport;

        transport.setLatencyProfile(perfil);
        await transport.connect(channelId, track);
        sounds.play('join');
        void window.concord.presence.setVoiceChannel(channelId).catch(() => undefined);
        // Impede o Windows de suspender no meio da chamada.
        void window.concord.settings.setCallActive(true).catch(() => undefined);
        setState((s) => ({
          ...s,
          connecting: false,
          graphLatencyMs: engine.getGraphLatencyMs(),
          joinedAt: Date.now(),
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
    [anexarAudio, anexarTela, atualizarParticipantes, desanexarPeer, leave, nomeDe],
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

  /**
   * Quem esta falando agora, a partir do nivel de audio real de cada faixa.
   *
   * 150ms e rapido o bastante para o anel acender junto com a fala, sem
   * chegar a ser um medidor de VU - so um sim/nao por pessoa.
   *
   * O LIMIAR e a HISTERESE evitam o pisca-pisca em fala normal: fica "falando"
   * um pouco alem do ultimo som para nao apagar entre palavras, mas nao tanto
   * que pareca travado depois que a pessoa para.
   */
  useEffect(() => {
    if (!state.channelId) return;
    const LIMIAR = 0.02;
    const HISTERESE_MS = 300;
    const ultimaFala = new Map<string, number>();

    const id = setInterval(() => {
      const transport = transportRef.current;
      if (!transport) return;
      const niveis = transport.audioLevels();
      const agora = Date.now();

      for (const [key, nivel] of niveis) {
        if (nivel >= LIMIAR) ultimaFala.set(key, agora);
      }

      setState((s) => {
        let mudou = false;
        const participants = s.participants.map((p) => {
          const falandoAgora = (agora - (ultimaFala.get(p.key) ?? 0)) < HISTERESE_MS;
          if (falandoAgora === p.speaking) return p;
          mudou = true;
          return { ...p, speaking: falandoAgora };
        });
        return mudou ? { ...s, participants } : s;
      });
    }, 150);

    return () => clearInterval(id);
  }, [state.channelId]);

  // A lista de silenciados por moderacao tambem precisa refletir no campo
  // `muted` de cada participante, usado pelos indicadores visuais.
  useEffect(() => {
    setState((s) => ({
      ...s,
      participants: s.participants.map((p) =>
        p.muted === mutedKeys.has(p.key) ? p : { ...p, muted: mutedKeys.has(p.key) },
      ),
    }));
  }, [mutedKeys]);

  /** Silencia (ou volta a ouvir) uma pessoa so para mim. */
  const toggleLocalMute = useCallback((peerKey: string) => {
    setLocalMutedKeys((atual) => {
      const proximo = new Set(atual);
      const ligar = !proximo.has(peerKey);
      if (ligar) proximo.add(peerKey);
      else proximo.delete(peerKey);
      mixerRef.current.setLocalMuted(peerKey, ligar);
      return proximo;
    });
  }, []);

  /** Fixa uma pessoa no palco; clicar em quem ja esta fixado desafixa. */
  const togglePin = useCallback((peerKey: string) => {
    setPinned((atual) => (atual === peerKey ? null : peerKey));
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

  /** Reconecta sem sair da chamada. */
  const reconnect = useCallback(async () => {
    await transportRef.current?.reconnectAll();
    sounds.play('success');
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

        sounds.play('screenStart');
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
    sounds.play('screenStop');
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

    transportRef.current?.announcePaused(engine.isPaused());
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

  // A lista de silenciados muda por operacao vinda da rede; reaplica na hora.
  useEffect(() => {
    const mixer = mixerRef.current;
    for (const peerKey of mixer.keys()) mixer.setModerationMuted(peerKey, mutedKeys.has(peerKey));
  }, [mutedKeys]);

  useEffect(() => {
    const mixer = mixerRef.current;
    return () => {
      void transportRef.current?.disconnect();
      void engineRef.current?.stop();
      void screenRef.current.stop();
      mixer.stop();
    };
  }, []);

  return {
    state,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    reconnect,
    setTransmitMode,
    startScreenShare,
    stopScreenShare,
    toggleScreenPause,
    switchScreenSource,
    applyScreenQuality,
    remoteScreens,
    peersPausados,
    peerVolumes,
    setPeerVolume,
    localMutedKeys,
    toggleLocalMute,
    pinned,
    togglePin,
  };
}
