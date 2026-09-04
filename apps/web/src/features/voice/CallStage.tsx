import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  RefreshCw,
  Gauge,
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Pause,
  PhoneOff,
  Pin,
  Play,
  Repeat,
  Signal,
} from 'lucide-react';
import { Avatar } from '../../components/ui';
import { CallState } from './useVoiceCall';
import { formatDuration, useCallDuration } from './useCallDuration';

/** Um quadro da grade: uma pessoa, com ou sem tela compartilhada. */
interface Tile {
  key: string;
  name: string;
  isSelf: boolean;
  stream: MediaStream | null;
  speaking: boolean;
  muted: boolean;
  sharing: boolean;
  paused: boolean;
  connection: RTCPeerConnectionState | null;
  latencyMs: number | null;
  quality: string | null;
}

const CORES_QUALIDADE: Record<string, string> = {
  excelente: 'text-status-online',
  media: 'text-status-idle',
  ruim: 'text-status-dnd',
  desconhecida: 'text-ink-400',
};

/**
 * Colunas da grade em funcao da quantidade.
 *
 * Mantido como tabela em vez de formula porque o que fica bom em 5 e 6
 * participantes nao sai de um arredondamento de raiz quadrada.
 */
function colunasPara(total: number): string {
  if (total <= 1) return 'grid-cols-1';
  if (total <= 4) return 'grid-cols-2';
  if (total <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

function Video({ stream, mirrored }: { stream: MediaStream; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  // O id da faixa entra na dependencia: o MediaStream e o mesmo objeto quando
  // o peer reinicia a transmissao, e sem isto o elemento continuaria ligado a
  // faixa antiga, ja encerrada.
  const trackId = stream.getVideoTracks()[0]?.id;

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => undefined);
  }, [stream, trackId]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      // O video local sempre mudo: ouvir a propria captura causaria eco.
      muted
      className="h-full w-full bg-black object-contain"
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}

function TileCard({
  tile,
  onFocus,
  focused,
}: {
  tile: Tile;
  onFocus: () => void;
  focused: boolean;
}) {
  return (
    <div
      onClick={tile.stream ? onFocus : undefined}
      className={`group relative overflow-hidden rounded-xl border bg-void-900 transition ${
        tile.speaking ? 'border-status-online shadow-glow' : 'border-void-700'
      } ${tile.stream ? 'cursor-pointer' : ''}`}
    >
      {tile.stream ? (
        <div className="aspect-video">
          <Video stream={tile.stream} />
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-void-850">
          <div className="relative">
            <Avatar name={tile.name} userKey={tile.key} size={72} />
            {tile.speaking && (
              <span className="absolute -inset-1 animate-pulse-ring rounded-full ring-4 ring-status-online" />
            )}
          </div>
        </div>
      )}

      {/* Faixa inferior com nome e estado */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent px-2.5 py-2">
        <span className="flex-1 truncate text-xs font-semibold text-ink-100">
          {tile.name}
          {tile.isSelf && <span className="ml-1 text-ink-400">(voce)</span>}
        </span>

        {tile.sharing && (
          <span
            title={tile.paused ? 'Transmissao pausada' : 'Transmitindo'}
            className={tile.paused ? 'text-status-idle' : 'text-violet-400'}
          >
            <Monitor className="h-3.5 w-3.5" />
          </span>
        )}
        {tile.muted && <MicOff className="h-3.5 w-3.5 text-status-dnd" />}
        {tile.latencyMs !== null && (
          <span
            title="Atraso medido de ponta a ponta"
            className="font-mono text-[10px] text-ink-300"
          >
            {Math.round(tile.latencyMs)}ms
          </span>
        )}
        {tile.quality && (
          <span title={`Conexao ${tile.quality}`} className={CORES_QUALIDADE[tile.quality]}>
            <Signal className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {tile.stream && !focused && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          title="Destacar"
          className="absolute right-2 top-2 rounded bg-black/70 p-1.5 text-ink-200 opacity-0 transition group-hover:opacity-100 hover:text-violet-300"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}

      {tile.connection && tile.connection !== 'connected' && (
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-status-idle">
          {tile.connection}
        </span>
      )}
    </div>
  );
}

/**
 * Palco da chamada: grade com todos os participantes e a tela de quem esta
 * transmitindo, incluindo o preview da propria transmissao.
 */
export function CallStage({
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
  onReconnect,
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
  onReconnect: () => void;
}) {
  const [focado, setFocado] = useState<string | null>(null);
  const duracao = useCallDuration(state.joinedAt);

  const tiles = useMemo<Tile[]>(() => {
    const proprio: Tile = {
      key: selfKey,
      name: selfName,
      isSelf: true,
      stream: state.localScreen,
      speaking: Boolean(state.audio?.transmitting) && !state.muted,
      muted: state.muted,
      sharing: state.screenSharing,
      paused: state.screenPaused,
      connection: null,
      latencyMs: null,
      quality: null,
    };

    const outros: Tile[] = state.participants.map((p) => ({
      key: p.key,
      name: p.name,
      isSelf: false,
      stream: remoteScreens.get(p.key) ?? null,
      speaking: false,
      muted: false,
      sharing: remoteScreens.has(p.key),
      paused: false,
      connection: p.connection,
      latencyMs: p.latency?.totalMs ?? null,
      quality: p.stats?.quality ?? null,
    }));

    return [proprio, ...outros];
  }, [state, selfKey, selfName, remoteScreens]);

  // Se quem estava em destaque parou de transmitir, volta para a grade.
  useEffect(() => {
    if (focado && !tiles.some((t) => t.key === focado && t.stream)) setFocado(null);
  }, [tiles, focado]);

  const emDestaque = focado ? tiles.find((t) => t.key === focado) : null;
  const secundarios = emDestaque ? tiles.filter((t) => t.key !== emDestaque.key) : [];

  return (
    <div className="flex h-full flex-col bg-void-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-void-800 px-4">
        <Monitor className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-ink-100">{state.channelName}</h3>
        <span className="text-xs text-ink-400">
          {tiles.length} {tiles.length === 1 ? 'participante' : 'participantes'}
        </span>
        {state.connecting ? (
          <span className="text-xs text-ink-400">conectando&hellip;</span>
        ) : (
          state.joinedAt !== null && (
            <span
              title="Tempo em chamada"
              className="flex items-center gap-1 font-mono text-xs text-ink-300"
            >
              <Clock className="h-3 w-3" />
              {formatDuration(duracao)}
            </span>
          )
        )}

        {state.graphLatencyMs !== null && (
          <span
            title="Atraso do processamento local de audio"
            className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-400"
          >
            <Gauge className="h-3 w-3" />
            {state.graphLatencyMs.toFixed(0)}ms local
          </span>
        )}
      </header>

      {state.error && (
        <p className="mx-4 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {state.error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {emDestaque ? (
          <div className="flex h-full flex-col gap-3">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-violet-800/50 bg-black">
              {emDestaque.stream && <Video stream={emDestaque.stream} />}
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 py-2">
                <span className="flex-1 text-xs font-semibold text-ink-100">
                  {emDestaque.name}
                  {emDestaque.isSelf && <span className="ml-1 text-ink-400">(sua tela)</span>}
                </span>
                <button
                  onClick={() => setFocado(null)}
                  title="Voltar para a grade"
                  className="rounded bg-black/60 p-1.5 text-ink-200 hover:text-violet-300"
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {secundarios.length > 0 && (
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
                {secundarios.map((tile) => (
                  <div key={tile.key} className="w-44 shrink-0">
                    <TileCard tile={tile} focused={false} onFocus={() => setFocado(tile.key)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`grid gap-3 ${colunasPara(tiles.length)}`}>
            {tiles.map((tile) => (
              <TileCard
                key={tile.key}
                tile={tile}
                focused={false}
                onFocus={() => setFocado(tile.key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Barra de controles */}
      <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-void-800 bg-void-900 px-4 py-3">
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
          title={state.deafened ? 'Ouvir' : 'Silenciar tudo'}
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

        {state.screenSharing && (
          <>
            <button
              onClick={onTogglePause}
              title={state.screenPaused ? 'Retomar' : 'Pausar imagem'}
              className={`rounded-full p-3 transition ${
                state.screenPaused
                  ? 'bg-status-idle/20 text-status-idle'
                  : 'bg-void-700 text-ink-200 hover:bg-void-600'
              }`}
            >
              {state.screenPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            </button>
            <button
              onClick={onSwitchSource}
              title="Trocar fonte"
              className="rounded-full bg-void-700 p-3 text-ink-200 transition hover:bg-void-600"
            >
              <Repeat className="h-5 w-5" />
            </button>
          </>
        )}

        <button
          onClick={onReconnect}
          title="Reconectar — use se a imagem ou o audio travarem"
          className="rounded-full bg-void-700 p-3 text-ink-200 transition hover:bg-void-600 hover:text-violet-300"
        >
          <RefreshCw className="h-5 w-5" />
        </button>

        <button
          onClick={onLeave}
          title="Sair da chamada"
          className="ml-4 rounded-full bg-status-dnd/80 p-3 text-white transition hover:bg-status-dnd"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </footer>
    </div>
  );
}
