import { Compass, Plus, Users } from 'lucide-react';
import { Tooltip } from '../components/ui';
import type { ServerView } from '../types/concord-api';

/**
 * Trilha de servidores, na lateral esquerda.
 *
 * O topo leva para a tela inicial (amigos); abaixo do separador ficam os
 * servidores e, no fim, criar e entrar com convite. A pilula branca a
 * esquerda indica o item ativo, como no Discord.
 */
export function ServerRail({
  servers,
  activeServer,
  homeActive,
  pendingCount,
  voiceServerId,
  onHome,
  onSelect,
  onCreate,
  onJoin,
}: {
  servers: ServerView[];
  activeServer: string | null;
  homeActive: boolean;
  /** Pedidos de amizade e convites esperando resposta. */
  pendingCount: number;
  /** Servidor da chamada de voz em andamento, para marcar o icone. */
  voiceServerId: string | null;
  onHome: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <nav
      aria-label="Servidores"
      className="scroll-none flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-void-950 py-3"
    >
      <RailItem label="Mensagens e amigos" active={homeActive} badge={pendingCount}>
        <button
          onClick={onHome}
          aria-label="Mensagens e amigos"
          className={`flex h-12 w-12 items-center justify-center transition-all duration-200 ${
            homeActive
              ? 'rounded-2xl bg-violet-600 text-white'
              : 'rounded-[24px] bg-void-800 text-ink-200 hover:rounded-2xl hover:bg-violet-600 hover:text-white'
          }`}
        >
          <Users className="h-6 w-6" />
        </button>
      </RailItem>

      <div className="mx-auto h-0.5 w-8 shrink-0 rounded-full bg-void-700" />

      {servers.map((s) => {
        const ativo = !homeActive && s.id === activeServer;
        return (
          <RailItem key={s.id} label={s.name} active={ativo} voice={voiceServerId === s.id}>
            <button
              onClick={() => onSelect(s.id)}
              aria-label={`Servidor: ${s.name}`}
              className={`flex h-12 w-12 items-center justify-center overflow-hidden text-sm font-bold transition-all duration-200 ${
                ativo
                  ? 'rounded-2xl bg-violet-600 text-white'
                  : 'rounded-[24px] bg-void-800 text-ink-200 hover:rounded-2xl hover:bg-violet-600 hover:text-white'
              }`}
            >
              {s.icon ? (
                <img src={s.icon} alt="" draggable={false} className="h-full w-full object-cover" />
              ) : (
                iniciais(s.name)
              )}
            </button>
          </RailItem>
        );
      })}

      <RailItem label="Criar servidor">
        <button
          onClick={onCreate}
          aria-label="Criar servidor"
          className="flex h-12 w-12 items-center justify-center rounded-[24px] bg-void-800 text-status-online transition-all duration-200 hover:rounded-2xl hover:bg-status-online hover:text-void-950"
        >
          <Plus className="h-6 w-6" />
        </button>
      </RailItem>

      <RailItem label="Entrar com um convite">
        <button
          onClick={onJoin}
          aria-label="Entrar com um convite"
          className="flex h-12 w-12 items-center justify-center rounded-[24px] bg-void-800 text-violet-400 transition-all duration-200 hover:rounded-2xl hover:bg-violet-600 hover:text-white"
        >
          <Compass className="h-6 w-6" />
        </button>
      </RailItem>
    </nav>
  );
}

/** Abreviacao do nome do servidor: iniciais das palavras, ate 3 letras. */
function iniciais(nome: string) {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length <= 1) return nome.slice(0, 2).toUpperCase();
  return palavras
    .slice(0, 3)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function RailItem({
  label,
  active,
  badge,
  voice,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  voice?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="right" className="group relative flex w-full justify-center">
      {/* Pilula indicadora */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200 ${
          active ? 'h-10' : 'h-0 group-hover:h-5'
        }`}
      />
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="pointer-events-none absolute bottom-0 right-3 flex h-5 min-w-5 items-center justify-center rounded-full border-4 border-void-950 bg-status-dnd px-1 text-[10px] font-bold leading-none text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      {voice && (
        <span
          title="Chamada de voz em andamento"
          className="pointer-events-none absolute bottom-0 right-3 h-4 w-4 rounded-full border-[3px] border-void-950 bg-status-online"
        />
      )}
    </Tooltip>
  );
}
