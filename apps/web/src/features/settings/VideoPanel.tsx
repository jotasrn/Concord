import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Monitor } from 'lucide-react';
import { Button, ErrorBanner } from '../../components/ui';
import { listVideoDevices, onDeviceChange, AudioDevice } from '../voice/audio/devices';
import { PRESETS } from '../screenshare/presets';

const ALTURAS = [480, 720, 1080];
const TAXAS = [15, 24, 30, 60];

/**
 * Configuracoes de video: camera e padroes de compartilhamento de tela.
 *
 * O preview usa a camera de verdade, entao serve para conferir enquadramento e
 * iluminacao antes de entrar numa chamada - e para descobrir se a camera
 * funciona sem precisar ligar para alguem.
 */
export function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameras, setCameras] = useState<AudioDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [altura, setAltura] = useState(720);
  const [taxa, setTaxa] = useState(30);
  const [presetTela, setPresetTela] = useState('gaming');
  const [ligada, setLigada] = useState(false);
  const [real, setReal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.concord.settings
      .get()
      .then((r) => {
        setDeviceId(r.settings.video.cameraDeviceId ?? '');
        setAltura(r.settings.video.cameraHeight);
        setTaxa(r.settings.video.cameraFrameRate);
        setPresetTela(r.settings.video.screenPresetId);
      })
      .catch(() => undefined);

    void listVideoDevices().then(setCameras);
    return onDeviceChange(() => void listVideoDevices().then(setCameras));
  }, []);

  // Garante que a camera seja liberada ao sair da tela.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function salvar(patch: Record<string, unknown>) {
    try {
      const atual = await window.concord.settings.get();
      await window.concord.settings.save({
        ...atual.settings,
        video: { ...atual.settings.video, ...patch },
      });
    } catch {
      // Falhar ao guardar preferencia nao deve interromper o preview.
    }
  }

  async function ligar() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          height: { ideal: altura },
          frameRate: { ideal: taxa },
        },
        audio: false,
      });

      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setLigada(true);

      // Mostra o que a camera entregou, que raramente e exatamente o pedido.
      const s = stream.getVideoTracks()[0]?.getSettings();
      setReal(s ? `${s.width}x${s.height} @${Math.round(s.frameRate ?? 0)}fps` : null);

      // Rotulos das cameras so aparecem apos a permissao ser concedida.
      void listVideoDevices().then(setCameras);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Nao foi possivel abrir a camera: ${e.message}`
          : 'Nao foi possivel abrir a camera',
      );
    }
  }

  function desligar() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLigada(false);
    setReal(null);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-ink-100">Video</h2>
      <ErrorBanner message={error} />

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">Camera</label>
        <select
          className="field"
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            void salvar({ cameraDeviceId: e.target.value || null });
            if (ligada) void ligar();
          }}
        >
          <option value="">Padrao do sistema</option>
          {cameras.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label}
            </option>
          ))}
        </select>
        {cameras.length === 0 && (
          <p className="text-[11px] text-ink-400">
            Nenhuma camera encontrada. Ligue o preview para conceder a permissao e listar.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-ink-400">Preview</label>
          {ligada ? (
            <Button variant="ghost" onClick={desligar}>
              <span className="flex items-center gap-2">
                <CameraOff className="h-3.5 w-3.5" /> Desligar
              </span>
            </Button>
          ) : (
            <Button onClick={ligar}>
              <span className="flex items-center gap-2">
                <Camera className="h-3.5 w-3.5" /> Testar camera
              </span>
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-void-600 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            // Espelhado: e assim que a pessoa se ve no espelho, e o contrario
            // parece errado no proprio preview.
            className="aspect-video w-full object-contain"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
        {real && <p className="text-right font-mono text-[10px] text-ink-400">entregue: {real}</p>}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-ink-400">Resolucao</span>
          <select
            className="field"
            value={altura}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAltura(v);
              void salvar({ cameraHeight: v });
              if (ligada) void ligar();
            }}
          >
            {ALTURAS.map((a) => (
              <option key={a} value={a}>
                {a}p
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-ink-400">Quadros por segundo</span>
          <select
            className="field"
            value={taxa}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTaxa(v);
              void salvar({ cameraFrameRate: v });
              if (ligada) void ligar();
            }}
          >
            {TAXAS.map((t) => (
              <option key={t} value={t}>
                {t} fps
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-2 border-t border-void-700 pt-4">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
          <Monitor className="h-3.5 w-3.5" /> Padrao ao compartilhar tela
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              title={p.description}
              onClick={() => {
                setPresetTela(p.id);
                void salvar({ screenPresetId: p.id });
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                presetTela === p.id
                  ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                  : 'border-void-600 text-ink-300 hover:border-violet-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">
          Vem selecionado no seletor de tela; da para trocar na hora de transmitir.
        </p>
      </section>

      <p className="text-[11px] text-ink-400">
        A camera ainda nao e transmitida nas chamadas &mdash; hoje o video da call e o
        compartilhamento de tela. Estas configuracoes valem para o teste e ja ficam guardadas para
        quando a webcam entrar.
      </p>
    </div>
  );
}
