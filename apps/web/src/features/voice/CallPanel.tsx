import { Headphones, HeadphoneOff, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Signal, Volume2 } from 'lucide-react';
import { Avatar } from '../../components/ui';
import { CallState } from './useVoiceCall';
import { formatDuration, useCallDuration } from './useCallDuration';
import { ShareControls } from '../screenshare/ShareControls';

const CORES_QUALIDADE: Record<string, string> = {
  excelente: 'text-status-online',
  media: 'text-status-idle',
  ruim: 'text-status-dnd',
  desconhecida: 'text-ink-400',
};

/** Painel fixo no rodape da barra de canais enquanto a chamada esta ativa. */
export function CallPanel({
  state,
  selfName,
  selfKey,
  remoteScreens,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onStartScreenShare,
  onStopScreenShare,
  onTogglePause,
  onSwitchSource,
}: {
  state: CallState;
  selfName: string;
  selfKey: string;
  remoteScreens: Map<string, MediaStream>;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
  onTogglePause: () => void;
  onSwitchSource: () => void;
}) {
  // Hook antes de qualquer return condicional, senao a contagem de hooks muda
  // quando a chamada termina.
  const duracao = useCallDuration(state.joinedAt);
  if (!state.channelId) return null;

  const falando = state.audio?.transmitting && !state.muted;

  return (
    <section className="border-t border-violet-900/60 bg-violet-950/20 p-3">
      <header className="mb-2 flex items-center gap-2">
        <Volume2 className="h-3.5 w-3.5 text-violet-400" />
        <span className="truncate text-xs font-semibold text-violet-200">
          {state.channelName}
        </span>
        {state.connecting ? (
          <span className="text-[10px] text-ink-400">conectando...</span>
        ) : (
          state.joinedAt !== null && (
            <span className="font-mono text-[10px] text-ink-400">{formatDuration(duracao)}</span>
          )
        )}
        {state.screenSharing && (
          <span className="ml-auto flex items-center gap-1 rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
            <Monitor className="h-2.5 w-2.5" />
            ao vivo
          </span>
        )}
      </header>

      {state.error && (
        <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          {state.error}
        </p>
      )}

      <div className="mb-2 space-y-1">
        {/* Voce */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Avatar name={selfName} userKey={selfKey} size={26} />
            {falando && (
              <span className="absolute -inset-0.5 rounded-full ring-2 ring-status-online animate-pulse-ring" />
            )}
          </div>
          <span className="flex-1 truncate text-xs text-ink-200">{selfName}</span>
          {state.screenSharing && (
            <span title="Compartilhando tela">
              <Monitor className="h-3 w-3 text-violet-400" />
            </span>
          )}
          {state.muted && <MicOff className="h-3 w-3 text-status-dnd" />}
        </div>

        {/* Peers */}
        {state.participants.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <Avatar name={p.name} userKey={p.key} size={26} />
            <span className="flex-1 truncate text-xs text-ink-200">{p.name}</span>
            {remoteScreens.has(p.key) && (
              <span title="Compartilhando tela">
                <Monitor className="h-3 w-3 text-violet-400" />
              </span>
            )}
            {p.stats && (
              <span
                title={[
                  p.stats.rttMs !== null ? `ping ${p.stats.rttMs.toFixed(0)}ms` : null,
                  p.stats.jitterMs !== null ? `jitter ${p.stats.jitterMs.toFixed(1)}ms` : null,
                  p.stats.packetLossPercent !== null
                    ? `perda ${p.stats.packetLossPercent.toFixed(1)}%`
                    : null,
                  p.stats.audioBitrateKbps !== null
                    ? `${p.stats.audioBitrateKbps.toFixed(0)} kbps`
                    : null,
                  p.stats.codec ? `codec ${p.stats.codec}` : null,
                ]
                  .filter(Boolean)
                  .join(' | ')}
                className={CORES_QUALIDADE[p.stats.quality]}
              >
                <Signal className="h-3 w-3" />
              </span>
            )}
            {p.connection !== 'connected' && (
              <span className="text-[9px] text-ink-400">{p.connection}</span>
            )}
          </div>
        ))}

        {state.participants.length === 0 && !state.connecting && (
          <p className="text-[11px] text-ink-400">Sozinho no canal.</p>
        )}
      </div>

      <div className="flex gap-1">
        <button
          onClick={onToggleMute}
          title={state.muted ? 'Desmutar' : 'Mutar'}
          className={`flex-1 rounded p-1.5 transition ${
            state.muted
              ? 'bg-status-dnd/20 text-status-dnd'
              : 'text-ink-300 hover:bg-void-700 hover:text-violet-400'
          }`}
        >
          {state.muted ? (
            <MicOff className="mx-auto h-4 w-4" />
          ) : (
            <Mic className="mx-auto h-4 w-4" />
          )}
        </button>
        <button
          onClick={onToggleDeafen}
          title={state.deafened ? 'Ouvir' : 'Silenciar tudo'}
          className={`flex-1 rounded p-1.5 transition ${
            state.deafened
              ? 'bg-status-dnd/20 text-status-dnd'
              : 'text-ink-300 hover:bg-void-700 hover:text-violet-400'
          }`}
        >
          {state.deafened ? (
            <HeadphoneOff className="mx-auto h-4 w-4" />
          ) : (
            <Headphones className="mx-auto h-4 w-4" />
          )}
        </button>
        <button
          onClick={state.screenSharing ? onStopScreenShare : onStartScreenShare}
          title={state.screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
          className={`flex-1 rounded p-1.5 transition ${
            state.screenSharing
              ? 'bg-violet-600/30 text-violet-300 hover:bg-status-dnd/20 hover:text-status-dnd'
              : 'text-ink-300 hover:bg-void-700 hover:text-violet-400'
          }`}
        >
          {state.screenSharing ? (
            <MonitorOff className="mx-auto h-4 w-4" />
          ) : (
            <Monitor className="mx-auto h-4 w-4" />
          )}
        </button>
        <button
          onClick={onLeave}
          title="Sair da chamada"
          className="flex-1 rounded bg-status-dnd/15 p-1.5 text-status-dnd transition hover:bg-status-dnd/30"
        >
          <PhoneOff className="mx-auto h-4 w-4" />
        </button>
      </div>

      {state.screenSharing && (
        <ShareControls
          capture={state.capture}
          stats={state.screenStats}
          paused={state.screenPaused}
          onTogglePause={onTogglePause}
          onSwitchSource={onSwitchSource}
        />
      )}
    </section>
  );
}
