import { useEffect, useRef, useState } from 'react';
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Phone,
  PhoneOff,
} from 'lucide-react';
import { Avatar } from '../../components/ui';
import { formatDuration, useCallDuration } from './useCallDuration';
import { DirectCallState } from './useDirectCall';
import { VOLUME_MAXIMO } from './audio/RemoteAudioMixer';

function Video({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackId = stream.getVideoTracks()[0]?.id;
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
  }, [stream, trackId]);
  return <video ref={ref} autoPlay playsInline className="h-full w-full bg-black object-contain" />;
}

/**
 * Sobrepoe a tela inteira enquanto ha uma chamada direta em qualquer fase -
 * tocando, chamando ou ativa. Assim como uma ligacao de telefone de verdade,
 * ela nao compete por espaco com o resto da interface: ou voce esta nela, ou
 * nao esta.
 */
export function DirectCallOverlay({
  state,
  onAccept,
  onDecline,
  onHangUp,
  onToggleMute,
  onToggleDeafen,
  onStartScreenShare,
  onStopScreenShare,
  peerVolume,
  onPeerVolume,
}: {
  state: DirectCallState;
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  peerVolume: number;
  onPeerVolume: (v: number) => void;
}) {
  const duracao = useCallDuration(state.joinedAt);
  // Mostra o motivo de encerramento por um instante antes de sumir de vez.
  const [avisoFinal, setAvisoFinal] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase !== 'idle' || !state.endReason) return;
    setAvisoFinal(state.endReason);
    const id = setTimeout(() => setAvisoFinal(null), 3500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.endReason]);

  if (state.phase === 'idle') {
    if (!avisoFinal) return null;
    return (
      <div className="fixed inset-x-0 bottom-6 z-90 flex justify-center">
        <p className="rounded-full border border-void-700 bg-void-900/95 px-4 py-2 text-xs text-ink-300 shadow-xl">
          Chamada encerrada &mdash; {avisoFinal}
        </p>
      </div>
    );
  }

  const tocandoRecebida = state.phase === 'ringing-in';
  const tocandoSaida = state.phase === 'ringing-out';

  return (
    <div className="fixed inset-0 z-90 flex flex-col items-center justify-center bg-black/90 backdrop-blur-xs">
      {state.remoteScreen ? (
        <div className="relative aspect-video w-full max-w-4xl overflow-hidden rounded-xl border border-violet-800/50 bg-black">
          <Video stream={state.remoteScreen} />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-black/90 to-transparent px-3 py-2">
            <Avatar
              name={state.peerName}
              userKey={state.peerKey ?? ''}
              src={state.peerAvatar}
              size={28}
            />
            <span className="text-sm font-semibold text-ink-100">{state.peerName}</span>
          </div>
        </div>
      ) : (
        <div className="relative mb-6">
          <Avatar
            name={state.peerName}
            userKey={state.peerKey ?? ''}
            src={state.peerAvatar}
            size={112}
          />
          {(tocandoRecebida || tocandoSaida) && (
            <span className="absolute -inset-2 animate-pulse-ring rounded-full ring-4 ring-violet-500" />
          )}
          {state.phase === 'active' && state.peerSpeaking && (
            <span className="absolute -inset-2 animate-pulse-ring rounded-full ring-4 ring-status-online" />
          )}
        </div>
      )}

      <h2 className="mb-1 text-xl font-bold text-ink-100">{state.peerName}</h2>
      <p className="mb-6 text-sm text-ink-400">
        {tocandoRecebida && 'Chamada recebida'}
        {tocandoSaida && 'Chamando…'}
        {state.phase === 'connecting' && 'Conectando…'}
        {state.phase === 'active' && formatDuration(duracao)}
      </p>

      {state.error && (
        <p className="mb-4 max-w-sm rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">
          {state.error}
        </p>
      )}

      {tocandoRecebida ? (
        <div className="flex gap-6">
          <button
            onClick={onDecline}
            title="Recusar"
            className="rounded-full bg-status-dnd p-4 text-white transition hover:brightness-110"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
          <button
            onClick={onAccept}
            title="Atender"
            className="rounded-full bg-status-online p-4 text-void-950 transition hover:brightness-110"
          >
            <Phone className="h-6 w-6" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {state.phase === 'active' && (
            <>
              <button
                onClick={onToggleMute}
                title={state.muted ? 'Desmutar' : 'Mutar'}
                className={`rounded-full p-3 transition ${
                  state.muted
                    ? 'bg-status-dnd/20 text-status-dnd'
                    : 'bg-void-700 text-ink-200 hover:bg-void-600'
                }`}
              >
                {state.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                onClick={onToggleDeafen}
                title={state.deafened ? 'Ouvir' : 'Silenciar'}
                className={`rounded-full p-3 transition ${
                  state.deafened
                    ? 'bg-status-dnd/20 text-status-dnd'
                    : 'bg-void-700 text-ink-200 hover:bg-void-600'
                }`}
              >
                {state.deafened ? (
                  <HeadphoneOff className="h-5 w-5" />
                ) : (
                  <Headphones className="h-5 w-5" />
                )}
              </button>
              <button
                onClick={state.screenSharing ? onStopScreenShare : onStartScreenShare}
                title={state.screenSharing ? 'Parar transmissao' : 'Compartilhar tela'}
                className={`rounded-full p-3 transition ${
                  state.screenSharing
                    ? 'bg-violet-600 text-white hover:bg-status-dnd'
                    : 'bg-void-700 text-ink-200 hover:bg-void-600'
                }`}
              >
                {state.screenSharing ? (
                  <MonitorOff className="h-5 w-5" />
                ) : (
                  <Monitor className="h-5 w-5" />
                )}
              </button>
              <div className="flex items-center gap-1.5 rounded-full bg-void-800 px-3 py-2">
                <input
                  type="range"
                  min={0}
                  max={VOLUME_MAXIMO * 100}
                  step={5}
                  value={Math.round(peerVolume * 100)}
                  onChange={(e) => onPeerVolume(Number(e.target.value) / 100)}
                  onDoubleClick={() => onPeerVolume(1)}
                  aria-label="Volume da pessoa"
                  className="h-1 w-20 cursor-pointer accent-violet-500"
                />
                <span className="w-9 font-mono text-[10px] text-ink-400">
                  {Math.round(peerVolume * 100)}%
                </span>
              </div>
            </>
          )}
          <button
            onClick={onHangUp}
            title={tocandoSaida ? 'Cancelar' : 'Encerrar'}
            className="ml-2 rounded-full bg-status-dnd p-4 text-white transition hover:brightness-110"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}
