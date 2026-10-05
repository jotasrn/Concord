import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Mic, MicOff } from 'lucide-react';
import { Button, ErrorBanner } from '../../components/ui';
import { AudioEngine, AudioEngineState, TransmitMode } from './audio/AudioEngine';
import { EqPreset } from './audio/Equalizer';
import { AudioDevice, listAudioDevices, onDeviceChange } from './audio/devices';

const EQ_OPTIONS: EqPreset[] = ['default', 'voice', 'warm', 'bright', 'radio'];
const MODE_LABELS: Record<TransmitMode, string> = {
  'voice-activity': 'Atividade de voz',
  'push-to-talk': 'Push-to-talk',
  'always-on': 'Sempre ligado',
};

/** Converte dBFS para largura de barra. -60 dB e o piso visual util. */
function dbToPercent(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(100, Math.max(0, ((db + 60) / 60) * 100));
}

export function AudioSettingsPanel() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [state, setState] = useState<AudioEngineState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [mode, setMode] = useState<TransmitMode>('voice-activity');
  const [eq, setEq] = useState<EqPreset>('voice');
  const [sensitivity, setSensitivity] = useState(50);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [prefs, setPrefs] = useState({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  useEffect(() => {
    void listAudioDevices().then((d) => setInputs(d.inputs));
    return onDeviceChange(() => void listAudioDevices().then((d) => setInputs(d.inputs)));
  }, []);

  useEffect(() => {
    return () => {
      void engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const engine = new AudioEngine({
        preferences: { ...prefs, deviceId: deviceId || null },
        transmitMode: mode,
        eqPreset: eq,
      });
      await engine.start();
      engine.setInputSensitivity(sensitivity);
      engine.subscribe(setState);
      engineRef.current = engine;
      setRunning(true);
      setSettings(engine.getActualSettings());
      // Rotulos so aparecem depois da permissao concedida.
      void listAudioDevices().then((d) => setInputs(d.inputs));
    } catch (e) {
      setError(
        e instanceof Error
          ? `Nao foi possivel abrir o microfone: ${e.message}`
          : 'Nao foi possivel abrir o microfone',
      );
    }
  }

  async function stop() {
    await engineRef.current?.stop();
    engineRef.current = null;
    setRunning(false);
    setState(null);
    setSettings(null);
  }

  const engine = engineRef.current;
  const levels = state?.levels;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-ink-100">Voz e video</h2>
      <ErrorBanner message={error} />

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">Microfone</label>
        <select
          className="field"
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            void engine?.switchDevice(e.target.value || null);
          }}
        >
          <option value="">Padrao do sistema</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-ink-400">Teste de entrada</label>
          {running ? (
            <Button variant="ghost" onClick={stop}>
              <span className="flex items-center gap-2">
                <MicOff className="h-3.5 w-3.5" /> Parar
              </span>
            </Button>
          ) : (
            <Button onClick={start}>
              <span className="flex items-center gap-2">
                <Mic className="h-3.5 w-3.5" /> Testar microfone
              </span>
            </Button>
          )}
        </div>

        {/* Barra de nivel: RMS preenchido, pico como marcador. */}
        <div className="relative h-4 overflow-hidden rounded-full bg-void-800">
          <div
            className={`h-full transition-[width] duration-75 ${
              state?.transmitting ? 'bg-violet-500' : 'bg-void-500'
            }`}
            style={{ width: `${dbToPercent(levels?.rmsDb ?? -Infinity)}%` }}
          />
          {levels && Number.isFinite(levels.peakDb) && (
            <div
              className="absolute top-0 h-full w-0.5 bg-violet-300"
              style={{ left: `${dbToPercent(levels.peakDb)}%` }}
            />
          )}
        </div>

        {levels && (
          <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-400">
            <span>RMS {levels.rmsDb === -Infinity ? '--' : levels.rmsDb.toFixed(1)} dB</span>
            <span>Pico {levels.peakDb === -Infinity ? '--' : levels.peakDb.toFixed(1)} dB</span>
            <span>Ruido {levels.noiseFloorDb.toFixed(1)} dB</span>
          </div>
        )}

        {levels?.clipping && (
          <p className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Clipping detectado &mdash; reduza o ganho do microfone no sistema.
          </p>
        )}

        {running && (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                state?.voiceState === 'SPEAKING'
                  ? 'animate-pulse-ring bg-status-online'
                  : 'bg-void-500'
              }`}
            />
            <span className="text-ink-300">
              {state?.calibrating
                ? 'Calibrando ruido de fundo... fique em silencio'
                : state?.voiceState === 'SPEAKING'
                  ? 'Falando'
                  : 'Silencio'}
            </span>
            {state?.transmitting && <span className="text-violet-400">&bull; transmitindo</span>}
          </div>
        )}

        {running && (
          <Button variant="ghost" onClick={() => engine?.calibrateNoiseFloor()}>
            Calibrar ruido de fundo
          </Button>
        )}
      </section>

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">Modo de transmissao</label>
        <div className="flex gap-2">
          {(Object.keys(MODE_LABELS) as TransmitMode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                engine?.setTransmitMode(m);
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs transition ${
                mode === m
                  ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                  : 'border-void-600 text-ink-300 hover:border-violet-700'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === 'push-to-talk' && (
          <p className="text-[11px] text-ink-400">
            Segure a tecla configurada para transmitir. A captura da tecla entra junto com a chamada
            de voz.
          </p>
        )}
      </section>

      {mode === 'voice-activity' && (
        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-ink-400">
            Sensibilidade de entrada &mdash; {sensitivity.toFixed(0)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={sensitivity}
            className="w-full accent-violet-500"
            onChange={(e) => {
              const v = Number(e.target.value);
              setSensitivity(v);
              engine?.setInputSensitivity(v);
            }}
          />
          <p className="text-[11px] text-ink-400">
            O limiar acompanha o ruido de fundo medido, entao nao dispara com ventilador ligado.
          </p>
        </section>
      )}

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">Equalizador</label>
        <div className="flex flex-wrap gap-2">
          {EQ_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => {
                setEq(p);
                engine?.setEqPreset(p);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition ${
                eq === p
                  ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                  : 'border-void-600 text-ink-300 hover:border-violet-700'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">Processamento</label>
        {(
          [
            ['echoCancellation', 'Cancelamento de eco'],
            ['noiseSuppression', 'Supressao de ruido'],
            ['autoGainControl', 'Controle automatico de ganho'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink-200">
            <input
              type="checkbox"
              className="accent-violet-500"
              checked={prefs[key]}
              onChange={(e) => {
                const next = { ...prefs, [key]: e.target.checked };
                setPrefs(next);
                void engine?.applyPreferences(next);
              }}
            />
            {label}
          </label>
        ))}
        <p className="text-[11px] text-ink-400">
          Supressao de ruido: <span className="text-ink-200">Nativa (WebRTC)</span>
        </p>
      </section>

      {settings && (
        <section className="space-y-1">
          <label className="text-xs uppercase tracking-wide text-ink-400">
            Entregue pelo navegador
          </label>
          <div className="selectable grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-void-600 bg-void-850 p-3 text-[11px] text-ink-300">
            {Object.entries(settings).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-ink-400">{k}</span>
                <span className="truncate font-mono">{String(v ?? '--')}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-400">
            Valores reais da track, nao o que foi pedido &mdash; o navegador pode ignorar
            constraints.
          </p>
        </section>
      )}
    </div>
  );
}
