import { useEffect, useRef } from 'react';
import { MoreHorizontal, Pin, PinOff, User, Volume2, VolumeX } from 'lucide-react';
import { Avatar } from '../../components/ui';
import { VOLUME_MAXIMO } from './audio/RemoteAudioMixer';

export interface ParticipantMenuTarget {
  key: string;
  name: string;
  avatar: string | null;
  isSelf: boolean;
  pinned: boolean;
  localMuted: boolean;
  volume: number;
  /** Ponto de ancoragem: canto do elemento clicado. */
  anchor: { x: number; y: number };
}

/**
 * Menu de acoes rapidas de quem esta na chamada.
 *
 * Aberto ao clicar em qualquer participante (avatar ou quadro de video).
 * Deliberadamente curto: as tres coisas que fazem sentido pedir sem sair da
 * chamada. Moderacao (cargo, expulsar, silenciar no servidor) mora no perfil
 * completo, que fica a um clique de distancia em "Ver perfil" - ela muda o
 * estado de todo mundo, entao merece uma tela propria, nao um item de menu
 * rapido.
 */
export function ParticipantMenu({
  target,
  onClose,
  onTogglePin,
  onToggleLocalMute,
  onVolumeChange,
  onOpenProfile,
}: {
  target: ParticipantMenuTarget;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleLocalMute: () => void;
  onVolumeChange: (volume: number) => void;
  onOpenProfile: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const aoClicarFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Captura, nao bubble: o clique que ABRIU o menu nao pode ser o mesmo que
    // o fecha na mesma volta de eventos.
    document.addEventListener('mousedown', aoClicarFora, true);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora, true);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [onClose]);

  // Mantem o menu dentro da tela mesmo quando o clique foi perto da borda.
  const LARGURA = 240;
  const ALTURA_ESTIMADA = target.isSelf ? 90 : 230;
  const x = Math.min(target.anchor.x, window.innerWidth - LARGURA - 12);
  const y = Math.min(target.anchor.y, window.innerHeight - ALTURA_ESTIMADA - 12);

  return (
    <div
      ref={ref}
      style={{ left: Math.max(12, x), top: Math.max(12, y), width: LARGURA }}
      className="fixed z-80 overflow-hidden rounded-xl border border-void-700 bg-void-900 shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-void-700 px-3 py-2.5">
        <Avatar name={target.name} userKey={target.key} src={target.avatar} size={32} />
        <p className="truncate text-sm font-semibold text-ink-100">{target.name}</p>
      </header>

      <div className="p-1">
        {!target.isSelf && (
          <>
            <button
              onClick={() => {
                onToggleLocalMute();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-200 transition hover:bg-void-700"
            >
              {target.localMuted ? (
                <Volume2 className="h-4 w-4 text-ink-400" />
              ) : (
                <VolumeX className="h-4 w-4 text-ink-400" />
              )}
              {target.localMuted ? 'Deixar de silenciar' : 'Silenciar so para mim'}
            </button>

            <div className="flex items-center gap-2.5 px-3 py-2">
              {target.volume === 0 ? (
                <VolumeX className="h-4 w-4 shrink-0 text-status-dnd" />
              ) : (
                <Volume2
                  className={`h-4 w-4 shrink-0 ${target.volume > 1 ? 'text-violet-400' : 'text-ink-400'}`}
                />
              )}
              <input
                type="range"
                min={0}
                max={VOLUME_MAXIMO * 100}
                step={5}
                value={Math.round(target.volume * 100)}
                onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                onDoubleClick={() => onVolumeChange(1)}
                aria-label="Volume desta pessoa"
                className="h-1 flex-1 cursor-pointer accent-violet-500"
              />
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-ink-400">
                {Math.round(target.volume * 100)}%
              </span>
            </div>
          </>
        )}

        <button
          onClick={onTogglePin}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-200 transition hover:bg-void-700"
        >
          {target.pinned ? (
            <PinOff className="h-4 w-4 text-ink-400" />
          ) : (
            <Pin className="h-4 w-4 text-ink-400" />
          )}
          {target.pinned ? 'Desafixar do palco' : 'Fixar no palco'}
        </button>

        {!target.isSelf && (
          <button
            onClick={onOpenProfile}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-200 transition hover:bg-void-700"
          >
            <User className="h-4 w-4 text-ink-400" />
            Ver perfil e moderacao
          </button>
        )}
      </div>
    </div>
  );
}

/** Botao "..." discreto que so aparece no hover, para abrir o menu por clique explicito. */
export function ParticipantMenuButton({
  onOpen,
}: {
  onOpen: (anchor: { x: number; y: number }) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onOpen({ x: rect.left, y: rect.bottom + 4 });
      }}
      title="Mais acoes"
      className="rounded-sm p-1 text-ink-300 opacity-0 transition hover:bg-void-700 hover:text-ink-100 group-hover:opacity-100"
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </button>
  );
}
