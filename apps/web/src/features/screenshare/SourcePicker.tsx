import { useEffect, useState } from 'react';
import { AppWindow, Monitor, RefreshCw, Volume2 } from 'lucide-react';
import { Button, ErrorBanner } from '../../components/ui';
import { CaptureSource } from './ScreenShareEngine';
import {
  BITRATE_STEPS,
  FPS_STEPS,
  HEIGHT_STEPS,
  PRESETS,
  PresetId,
  ScreenQuality,
  qualityFor,
} from './presets';

/** Seletor de fonte com miniaturas e ajuste de qualidade antes de transmitir. */
export function SourcePicker({
  onStart,
  onCancel,
}: {
  onStart: (source: CaptureSource, quality: ScreenQuality) => void;
  onCancel: () => void;
}) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selected, setSelected] = useState<CaptureSource | null>(null);
  const [preset, setPreset] = useState<PresetId>('gaming');
  const [custom, setCustom] = useState<ScreenQuality>({
    height: 1080,
    frameRate: 30,
    maxBitrate: 5_000_000,
    contentHint: 'motion',
    degradation: 'balanced',
    systemAudio: true,
  });
  const [aba, setAba] = useState<'screen' | 'window'>('screen');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      setSources(await window.concord.screen.sources());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel listar as fontes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const quality = qualityFor(preset, custom);
  const visiveis = sources.filter((s) => s.kind === aba);
  // Audio do sistema so existe capturando tela inteira.
  const audioDisponivel = selected?.kind === 'screen';

  function alterarCustom(patch: Partial<ScreenQuality>) {
    setCustom((c) => ({ ...c, ...patch }));
    setPreset('custom');
  }

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/85 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="panel flex h-[640px] w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-void-700 px-5 py-3">
          <Monitor className="h-4 w-4 text-violet-400" />
          <h2 className="flex-1 text-sm font-bold text-ink-100">Compartilhar tela</h2>
          <button
            onClick={carregar}
            title="Atualizar lista"
            className="rounded-sm p-1.5 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="flex gap-1 border-b border-void-700 px-5 pt-3">
          {(
            [
              ['screen', 'Telas', Monitor],
              ['window', 'Janelas', AppWindow],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-xs font-semibold transition ${
                aba === id ? 'bg-void-800 text-violet-300' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="text-ink-400">{sources.filter((s) => s.kind === id).length}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-void-800/40 p-4">
          <ErrorBanner message={error} />
          {loading && <p className="text-sm text-ink-400">Procurando fontes&hellip;</p>}
          {!loading && visiveis.length === 0 && (
            <p className="text-sm text-ink-400">Nenhuma fonte encontrada nesta aba.</p>
          )}

          <div className="grid grid-cols-3 gap-3">
            {visiveis.map((source) => (
              <button
                key={source.id}
                onClick={() => setSelected(source)}
                className={`overflow-hidden rounded-lg border text-left transition ${
                  selected?.id === source.id
                    ? 'border-violet-500 shadow-glow'
                    : 'border-void-600 hover:border-violet-700'
                }`}
              >
                <img
                  src={source.thumbnail}
                  alt=""
                  className="aspect-video w-full bg-black object-contain"
                />
                <div className="flex items-center gap-1.5 bg-void-850 px-2 py-1.5">
                  {source.appIcon ? (
                    <img src={source.appIcon} alt="" className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                  )}
                  <span className="truncate text-[11px] text-ink-200">{source.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-void-700 p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                title={p.description}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  preset === p.id
                    ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                    : 'border-void-600 text-ink-300 hover:border-violet-700'
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === 'custom' && (
              <span className="rounded-lg border border-violet-500 bg-violet-600/20 px-3 py-1.5 text-xs text-violet-200">
                Personalizado
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-[11px]">
            <label className="space-y-1">
              <span className="text-ink-400">Resolucao</span>
              <select
                className="field py-1 text-xs"
                value={quality.height}
                onChange={(e) => alterarCustom({ height: Number(e.target.value) })}
              >
                {HEIGHT_STEPS.map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-ink-400">Quadros por segundo</span>
              <select
                className="field py-1 text-xs"
                value={quality.frameRate}
                onChange={(e) => alterarCustom({ frameRate: Number(e.target.value) })}
              >
                {FPS_STEPS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-ink-400">Taxa maxima</span>
              <select
                className="field py-1 text-xs"
                value={quality.maxBitrate}
                onChange={(e) => alterarCustom({ maxBitrate: Number(e.target.value) })}
              >
                {BITRATE_STEPS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label
            className={`flex items-center gap-2 text-xs ${
              audioDisponivel ? 'text-ink-200' : 'cursor-not-allowed text-ink-400'
            }`}
            title={
              audioDisponivel
                ? 'Transmite o som do computador junto'
                : 'O som do sistema so pode ser capturado ao compartilhar uma tela inteira'
            }
          >
            <input
              type="checkbox"
              className="accent-violet-500"
              disabled={!audioDisponivel}
              checked={audioDisponivel && quality.systemAudio}
              onChange={(e) => alterarCustom({ systemAudio: e.target.checked })}
            />
            <Volume2 className="h-3.5 w-3.5" />
            Incluir som do computador
            {!audioDisponivel && <span className="text-ink-400">(so em tela inteira)</span>}
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button disabled={!selected} onClick={() => selected && onStart(selected, quality)}>
              Transmitir
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
