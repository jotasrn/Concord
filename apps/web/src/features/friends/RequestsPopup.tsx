import { Check, Server, UserPlus, X } from 'lucide-react';
import { Avatar } from '../../components/ui';

export interface FriendRequest {
  userKey: string;
  displayName: string;
  avatar: string | null;
}

export interface InviteRequest {
  serverId: string;
  serverName: string;
  fromKey: string;
  fromName: string;
}

/**
 * Popup de solicitacoes no canto superior direito.
 *
 * Fica fora do fluxo da pagina de proposito: um pedido pode chegar a qualquer
 * momento, inclusive durante uma chamada, e nao deve roubar a tela nem exigir
 * navegacao para ser respondido.
 */
export function RequestsPopup({
  friendRequests,
  inviteRequests,
  onRespondFriend,
  onRespondInvite,
}: {
  friendRequests: FriendRequest[];
  inviteRequests: InviteRequest[];
  onRespondFriend: (userKey: string, accepted: boolean) => void;
  onRespondInvite: (serverId: string, accepted: boolean) => void;
}) {
  const total = friendRequests.length + inviteRequests.length;
  if (total === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[65] flex w-80 flex-col gap-2">
      {friendRequests.map((pedido) => (
        <article
          key={pedido.userKey}
          className="pointer-events-auto overflow-hidden rounded-xl border border-violet-700/60 bg-void-900 shadow-glow"
        >
          <header className="flex items-center gap-2 border-b border-void-700 bg-violet-950/40 px-3 py-2">
            <UserPlus className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-violet-200">
              Pedido de amizade
            </span>
          </header>

          <div className="flex items-center gap-3 p-3">
            <Avatar
              name={pedido.displayName}
              userKey={pedido.userKey}
              src={pedido.avatar}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-100">
                {pedido.displayName || 'Sem nome'}
              </p>
              <p className="truncate font-mono text-[10px] text-ink-400">
                #{pedido.userKey.slice(0, 8)}
              </p>
            </div>
          </div>

          <div className="flex gap-1 border-t border-void-700 p-2">
            <button
              onClick={() => onRespondFriend(pedido.userKey, true)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              <Check className="h-3.5 w-3.5" /> Aceitar
            </button>
            <button
              onClick={() => onRespondFriend(pedido.userKey, false)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-void-700 py-1.5 text-xs text-ink-300 transition hover:bg-status-dnd/20 hover:text-status-dnd"
            >
              <X className="h-3.5 w-3.5" /> Recusar
            </button>
          </div>
        </article>
      ))}

      {inviteRequests.map((convite) => (
        <article
          key={convite.serverId}
          className="pointer-events-auto overflow-hidden rounded-xl border border-violet-700/60 bg-void-900 shadow-glow"
        >
          <header className="flex items-center gap-2 border-b border-void-700 bg-violet-950/40 px-3 py-2">
            <Server className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-violet-200">
              Convite de servidor
            </span>
          </header>

          <div className="flex items-center gap-3 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600/25 text-sm font-bold text-violet-200">
              {convite.serverName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-100">{convite.serverName}</p>
              <p className="truncate text-[10px] text-ink-400">
                de {convite.fromName || `#${convite.fromKey.slice(0, 8)}`}
              </p>
            </div>
          </div>

          <div className="flex gap-1 border-t border-void-700 p-2">
            <button
              onClick={() => onRespondInvite(convite.serverId, true)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-violet-600 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500"
            >
              <Check className="h-3.5 w-3.5" /> Entrar
            </button>
            <button
              onClick={() => onRespondInvite(convite.serverId, false)}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-void-700 py-1.5 text-xs text-ink-300 transition hover:bg-status-dnd/20 hover:text-status-dnd"
            >
              <X className="h-3.5 w-3.5" /> Ignorar
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
