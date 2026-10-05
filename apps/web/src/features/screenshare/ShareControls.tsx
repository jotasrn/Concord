import { Cpu, Gauge, Monitor, Pause, Play, Repeat, Wifi } from 'lucide-react';
import { CaptureInfo } from './ScreenShareEngine';
import { ScreenStats } from '../voice/transport/VoiceTransport';

/** Motivo da degradacao, traduzido do vocabulario do WebRTC. */
const LIMITACAO: Record<string, { label: string; icon: typeof Cpu }> = {
  cpu: { label: 'CPU no limite', icon: Cpu },
  bandwidth: { label: 'Banda no limite', icon: Wifi },
  other: { label: 'Limitado', icon: Gauge },
};

/**
 * Painel de quem esta transmitindo: o que esta sendo enviado de verdade, e o
 * porque de a qualidade cair quando cai.
 */
export function ShareControls({
  capture,
  stats,
  paused,
  onTogglePause,
  onSwitchSource,
}: {
  capture: CaptureInfo | null;
  stats: ScreenStats | null;
  paused: boolean;
  onTogglePause: () => void;
  onSwitchSource: () => void;
}) {
  if (!capture) return null;

  const limitacao =
    stats?.limitation && stats.limitation !== 'none' ? LIMITACAO[stats.limitation] : null;
  const LimitIcon = limitacao?.icon;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-violet-800/40 bg-violet-950/20 p-2">
      <div className="flex items-center gap-1.5">
        <Monitor className="h-3 w-3 shrink-0 text-violet-400" />
        <span className="flex-1 truncate text-[11px] font-semibold text-violet-200">
          {capture.sourceName}
        </span>
        {capture.hasAudio && (
          <span className="rounded-sm bg-violet-600/30 px-1 text-[9px] text-violet-300">som</span>
        )}
      </div>

      {/* Numeros reais do encoder, nao o que foi pedido no seletor. */}
      <div className="grid grid-cols-3 gap-1 font-mono text-[10px] text-ink-300">
        <span title="Resolucao enviada">
          {stats?.width && stats?.height
            ? `${stats.width}x${stats.height}`
            : `${capture.width}x${capture.height}`}
        </span>
        <span title="Quadros por segundo">
          {stats?.fps !== null && stats?.fps !== undefined
            ? `${Math.round(stats.fps)} fps`
            : `${capture.frameRate} fps`}
        </span>
        <span title="Taxa de transmissao">
          {stats?.bitrateKbps !== null && stats?.bitrateKbps !== undefined
            ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mb/s`
            : '--'}
        </span>
      </div>

      {stats?.codec && (
        <div className="font-mono text-[10px] text-ink-400">codec {stats.codec}</div>
      )}

      {limitacao && LimitIcon && (
        <div className="flex items-center gap-1 text-[10px] text-status-idle">
          <LimitIcon className="h-3 w-3" />
          {limitacao.label}
        </div>
      )}

      <div className="flex gap-1">
        <button
          onClick={onTogglePause}
          title={paused ? 'Retomar' : 'Pausar imagem'}
          className={`flex-1 rounded p-1 transition ${
            paused
              ? 'bg-status-idle/20 text-status-idle'
              : 'text-ink-300 hover:bg-void-700 hover:text-violet-400'
          }`}
        >
          {paused ? (
            <Play className="mx-auto h-3.5 w-3.5" />
          ) : (
            <Pause className="mx-auto h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onSwitchSource}
          title="Trocar fonte"
          className="flex-1 rounded-sm p-1 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
        >
          <Repeat className="mx-auto h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
