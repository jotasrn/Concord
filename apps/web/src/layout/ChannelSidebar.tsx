import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Link2,
  LogIn,
  MicOff,
  Plus,
  Signal,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Avatar, Popover, Tooltip } from '../components/ui';
import type { ChannelView, ServerView } from '../types/concord-api';

export interface VoiceOccupant {
  userKey: string;
  name: string;
  avatar: string | null;
  speaking: boolean;
  /** Detalhes que so existem para quem esta no mesmo canal que nos. */
  muted?: boolean;
  localMuted?: boolean;
  sharing?: boolean;
  qualityClass?: string;
  qualityTitle?: string;
  connection?: string;
}

/**
 * Coluna de canais do servidor: cabecalho com o menu do servidor, canais de
 * texto e de voz em categorias recolhiveis, e quem esta em cada canal de voz.
 */
export function ChannelSidebar({
  server,
  textChannels,
  voiceChannels,
  activeTextId,
  activeVoiceId,
  occupantsOf,
  onSelectText,
  onSelectVoice,
  onCreateChannel,
  onInvite,
  onAddMember,
  onJoinInvite,
  onOccupantClick,
}: {
  server: ServerView | null;
  textChannels: ChannelView[];
  voiceChannels: ChannelView[];
  activeTextId: string | null;
  activeVoiceId: string | null;
  occupantsOf: (channelId: string) => VoiceOccupant[];
  onSelectText: (id: string) => void;
  onSelectVoice: (id: string) => void;
  onCreateChannel: (type: 'TEXT' | 'VOICE') => void;
  onInvite: () => void;
  onAddMember: () => void;
  onJoinInvite: () => void;
  /** Clique em alguem dentro de um canal de voz (o rect ancora o menu). */
  onOccupantClick: (userKey: string, rect: DOMRect) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [recolhidos, setRecolhidos] = useState<Record<string, boolean>>({});

  const alternar = (id: string) => setRecolhidos((r) => ({ ...r, [id]: !r[id] }));

  return (
    <>
      <header className="relative shrink-0">
        <button
          disabled={!server}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu((m) => (m ? null : { x: r.left + 8, y: r.bottom + 6 }));
          }}
          className="flex h-12 w-full items-center gap-2 border-b border-void-950/80 px-4 text-left shadow-[0_1px_0_rgba(0,0,0,0.4)] transition hover:bg-void-800 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <h2 className="flex-1 truncate text-[15px] font-bold text-ink-100">
            {server?.name ?? 'Nenhum servidor'}
          </h2>
          {server &&
            (menu ? (
              <X className="h-4 w-4 text-ink-200" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-200" />
            ))}
        </button>
      </header>

      {menu && server && (
        <Popover anchor={menu} onClose={() => setMenu(null)} className="w-56">
          <MenuItem
            icon={<Link2 className="h-4 w-4" />}
            label="Convidar pessoas"
            accent
            onClick={() => {
              setMenu(null);
              onInvite();
            }}
          />
          <MenuItem
            icon={<UserPlus className="h-4 w-4" />}
            label="Adicionar pela chave"
            onClick={() => {
              setMenu(null);
              onAddMember();
            }}
          />
          <div className="mx-2 my-1 h-px bg-void-600" />
          <MenuItem
            icon={<Hash className="h-4 w-4" />}
            label="Criar canal de texto"
            onClick={() => {
              setMenu(null);
              onCreateChannel('TEXT');
            }}
          />
          <MenuItem
            icon={<Volume2 className="h-4 w-4" />}
            label="Criar canal de voz"
            onClick={() => {
              setMenu(null);
              onCreateChannel('VOICE');
            }}
          />
          <div className="mx-2 my-1 h-px bg-void-600" />
          <MenuItem
            icon={<LogIn className="h-4 w-4" />}
            label="Entrar com convite"
            onClick={() => {
              setMenu(null);
              onJoinInvite();
            }}
          />
        </Popover>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3 pt-4">
        {!server && (
          <p className="px-2 text-sm text-ink-400">
            Crie um servidor ou entre com um convite pela barra a esquerda.
          </p>
        )}

        {server && (
          <div className="space-y-4">
            <Categoria
              label="Canais de texto"
              recolhido={recolhidos.text}
              onToggle={() => alternar('text')}
              onAdd={() => onCreateChannel('TEXT')}
              addLabel="Criar canal de texto"
            >
              {textChannels.map((c) => {
                const ativo = c.id === activeTextId;
                if (recolhidos.text && !ativo) return null;
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelectText(c.id)}
                    className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] transition ${
                      ativo
                        ? 'bg-void-600 text-ink-100'
                        : 'text-ink-300 hover:bg-void-700 hover:text-ink-200'
                    }`}
                  >
                    <Hash className="h-5 w-5 shrink-0 text-ink-400" />
                    <span className={`flex-1 truncate text-left ${ativo ? 'font-medium' : ''}`}>
                      {c.name}
                    </span>
                  </button>
                );
              })}
              {textChannels.length === 0 && !recolhidos.text && (
                <p className="px-2 py-1 text-xs text-ink-400">Nenhum canal de texto.</p>
              )}
            </Categoria>

            <Categoria
              label="Canais de voz"
              recolhido={recolhidos.voice}
              onToggle={() => alternar('voice')}
              onAdd={() => onCreateChannel('VOICE')}
              addLabel="Criar canal de voz"
            >
              {voiceChannels.map((c) => {
                const ativo = c.id === activeVoiceId;
                const dentro = occupantsOf(c.id);
                if (recolhidos.voice && !ativo && dentro.length === 0) return null;
                return (
                  <div key={c.id}>
                    <button
                      onClick={() => onSelectVoice(c.id)}
                      title={ativo ? 'Alternar entre a chamada e o chat' : 'Entrar no canal de voz'}
                      className={`group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px] transition ${
                        ativo
                          ? 'bg-void-600 text-ink-100'
                          : 'text-ink-300 hover:bg-void-700 hover:text-ink-200'
                      }`}
                    >
                      <Volume2 className="h-5 w-5 shrink-0 text-ink-400" />
                      <span className={`flex-1 truncate text-left ${ativo ? 'font-medium' : ''}`}>
                        {c.name}
                      </span>
                      {dentro.length > 0 && (
                        <span className="rounded-full bg-void-950/60 px-1.5 text-[11px] font-semibold text-ink-300">
                          {dentro.length}
                        </span>
                      )}
                    </button>

                    {/* Quem esta na call agora, atualizado pela presenca dos peers. */}
                    {dentro.length > 0 && (
                      <ul className="mb-1 ml-7 mt-0.5 space-y-0.5">
                        {dentro.map((p) => (
                          <li key={p.userKey}>
                            <button
                              onClick={(e) =>
                                onOccupantClick(p.userKey, e.currentTarget.getBoundingClientRect())
                              }
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-void-700"
                            >
                              <Avatar
                                name={p.name}
                                userKey={p.userKey}
                                src={p.avatar}
                                size={22}
                                speaking={p.speaking}
                              />
                              <span
                                className={`flex-1 truncate text-sm ${
                                  p.speaking ? 'font-medium text-ink-100' : 'text-ink-300'
                                }`}
                              >
                                {p.name}
                              </span>
                              {p.sharing && (
                                <span className="rounded-sm bg-status-dnd px-1 text-[9px] font-bold uppercase leading-4 text-white">
                                  Ao vivo
                                </span>
                              )}
                              {p.localMuted && (
                                <span title="Voce silenciou esta pessoa">
                                  <VolumeX className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                                </span>
                              )}
                              {p.muted && (
                                <span title="Microfone desligado">
                                  <MicOff className="h-3.5 w-3.5 shrink-0 text-status-dnd" />
                                </span>
                              )}
                              {p.qualityClass && (
                                <span title={p.qualityTitle} className={p.qualityClass}>
                                  <Signal className="h-3.5 w-3.5" />
                                </span>
                              )}
                              {p.connection && p.connection !== 'connected' && (
                                <span className="text-[9px] text-ink-400">{p.connection}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {voiceChannels.length === 0 && !recolhidos.voice && (
                <p className="px-2 py-1 text-xs text-ink-400">Nenhum canal de voz.</p>
              )}
            </Categoria>
          </div>
        )}
      </div>
    </>
  );
}

function Categoria({
  label,
  recolhido,
  onToggle,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  recolhido?: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="group flex items-center pr-1">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-0.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-400 transition hover:text-ink-200"
        >
          {recolhido ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {label}
        </button>
        <Tooltip label={addLabel}>
          <button
            onClick={onAdd}
            aria-label={addLabel}
            className="rounded p-0.5 text-ink-400 transition hover:text-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </section>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`menu-item justify-between ${accent ? 'text-violet-300' : ''}`}
    >
      {label}
      {icon}
    </button>
  );
}
