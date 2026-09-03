import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Expand,
  Maximize2,
  Minimize2,
  Monitor,
  PictureInPicture2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface RemoteScreen {
  peerKey: string;
  peerName: string;
  stream: MediaStream;
}

interface InboundStats {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  codec: string;
}

/** Le metricas do video recebido direto do elemento e da conexao. */
function useInboundStats(video: HTMLVideoElement | null, active: boolean) {
  const [stats, setStats] = useState<InboundStats | null>(null);
  const anterior = useRef<{ frames: number; time: number } | null>(null);

  useEffect(() => {
    if (!video || !active) return;

    const id = setInterval(() => {
      // getVideoPlaybackQuality e a fonte de FPS real do lado de quem assiste:
      // conta os quadros efetivamente exibidos, nao os que foram enviados.
      const quality = video.getVideoPlaybackQuality?.();
      const agora = performance.now();
      let fps = 0;

      if (quality) {
        const frames = quality.totalVideoFrames;
        const ant = anterior.current;
        if (ant && agora > ant.time) {
          fps = ((frames - ant.frames) / (agora - ant.time)) * 1000;
        }
        anterior.current = { frames, time: agora };
      }

      setStats({
        width: video.videoWidth,
        height: video.videoHeight,
        fps: Math.round(fps),
        bitrateKbps: 0,
        codec: '',
      });
    }, 1000);

    return () => clearInterval(id);
  }, [video, active]);

  return stats;
}

function Viewer({
  screen,
  onClose,
}: {
  screen: RemoteScreen;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const stats = useInboundStats(videoRef.current, expanded || showStats);
  const temAudio = screen.stream.getAudioTracks().length > 0;

  // Depende do id da faixa: ao reiniciar a transmissao o stream e o mesmo
  // objeto, e sem isto o video ficaria preso na faixa encerrada.
  const trackId = screen.stream.getVideoTracks()[0]?.id;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = screen.stream;
    void videoRef.current.play().catch(() => undefined);
  }, [screen.stream, trackId]);

  // Zoom volta ao normal ao sair do fullscreen: um zoom preso na miniatura
  // deixaria o tile inutilizavel.
  useEffect(() => {
    if (!expanded) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(1, z - 0.25));
      if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      if (e.key.toLowerCase() === 'f') void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(5, Math.max(1, z - e.deltaY * 0.002)));
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }

  /**
   * Tela cheia de verdade, ocupando o monitor.
   *
   * O modo "expandido" preenche apenas a janela do app, o que ainda deixa a
   * barra de titulo e o resto do sistema a vista - pouco util para assistir a
   * uma transmissao.
   */
  async function toggleFullscreen() {
    const alvo = containerRef.current?.parentElement ?? containerRef.current;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (alvo) await alvo.requestFullscreen();
    } catch {
      // Sem tela cheia, o modo expandido continua disponivel.
    }
  }

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // PiP pode estar desabilitado; nao ha alternativa a oferecer aqui.
    }
  }

  const controles = (
    <>
      {temAudio && (
        <button
          onClick={() => {
            setMuted((m) => !m);
            if (videoRef.current) videoRef.current.muted = !muted;
          }}
          title={muted ? 'Ativar som' : 'Silenciar'}
          className="rounded p-1 text-ink-400 transition hover:bg-void-700 hover:text-violet-300"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        onClick={() => setShowStats((s) => !s)}
        title="Estatisticas"
        className={`rounded p-1 transition hover:bg-void-700 ${
          showStats ? 'text-violet-300' : 'text-ink-400 hover:text-violet-300'
        }`}
      >
        <Activity className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={togglePip}
        title="Picture-in-picture"
        className="rounded p-1 text-ink-400 transition hover:bg-void-700 hover:text-violet-300"
      >
        <PictureInPicture2 className="h-3.5 w-3.5" />
      </button>
    </>
  );

  const painelStats = showStats && stats && (
    <div className="absolute left-2 top-2 rounded bg-black/80 px-2 py-1 font-mono text-[10px] text-violet-200">
      <div>
        {stats.width}x{stats.height}
      </div>
      <div>{stats.fps} fps</div>
    </div>
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-black">
        <div className="flex items-center gap-2 bg-void-900 px-3 py-2">
          <Monitor className="h-3.5 w-3.5 text-violet-400" />
          <span className="flex-1 text-xs font-semibold text-violet-200">
            {screen.peerName} &mdash; tela compartilhada
          </span>
          <span className="mr-2 text-[10px] text-ink-400">
            Ctrl+roda zoom &bull; 0 reseta &bull; F tela cheia &bull; Esc sai
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            className="rounded p-1 text-ink-400 hover:bg-void-700 hover:text-violet-300"
            title="Menos zoom"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono text-[10px] text-ink-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
            className="rounded p-1 text-ink-400 hover:bg-void-700 hover:text-violet-300"
            title="Mais zoom"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          {controles}
          <button
            onClick={toggleFullscreen}
            title="Tela cheia — tecla F"
            className="rounded p-1 text-ink-400 hover:bg-void-700 hover:text-violet-300"
          >
            <Expand className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="rounded p-1 text-ink-400 hover:bg-void-700 hover:text-ink-100"
            title="Reduzir"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(false)}
          style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={muted}
            className="h-full w-full object-contain"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center',
            }}
          />
          {painelStats}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-violet-800/40 bg-void-900 shadow-lg">
      <div className="flex items-center gap-1.5 bg-void-900/95 px-2 py-1.5">
        <Monitor className="h-3 w-3 shrink-0 text-violet-400" />
        <span className="flex-1 truncate text-[11px] font-semibold text-violet-200">
          {screen.peerName}
        </span>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          {controles}
          <button
            onClick={() => setExpanded(true)}
            className="rounded p-1 text-ink-400 hover:bg-void-700 hover:text-violet-300"
            title="Tela cheia"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-400 hover:bg-status-dnd/20 hover:text-status-dnd"
            title="Ocultar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          onClick={() => setExpanded(true)}
          className="aspect-video w-full cursor-pointer bg-black object-contain"
          title="Clique para tela cheia"
        />
        {painelStats}
      </div>
    </div>
  );
}

/**
 * Painel flutuante com as telas que os peers estao compartilhando.
 *
 * O estado de "ocultado" precisa ser limpo quando o peer para de transmitir,
 * senao a proxima transmissao dele nao apareceria.
 */
export function ScreenViewer({
  remoteScreens,
  memberNames,
}: {
  remoteScreens: Map<string, MediaStream>;
  memberNames: Map<string, string>;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Este efeito precisa vir ANTES de qualquer return condicional: sair cedo
  // pularia a chamada e o React quebraria com "Rendered fewer hooks".
  useEffect(() => {
    setHidden((prev) => {
      const ativos = new Set(remoteScreens.keys());
      const restantes = new Set([...prev].filter((k) => ativos.has(k)));
      return restantes.size !== prev.size ? restantes : prev;
    });
  }, [remoteScreens]);

  const telas: RemoteScreen[] = [...remoteScreens.entries()]
    .filter(([key]) => !hidden.has(key))
    .map(([peerKey, stream]) => ({
      peerKey,
      stream,
      peerName: memberNames.get(peerKey) ?? `${peerKey.slice(0, 8)}...`,
    }));

  if (telas.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {telas.map((tela) => (
        <div key={tela.peerKey} className="pointer-events-auto w-80">
          <Viewer
            screen={tela}
            onClose={() => setHidden((prev) => new Set([...prev, tela.peerKey]))}
          />
        </div>
      ))}
    </div>
  );
}
