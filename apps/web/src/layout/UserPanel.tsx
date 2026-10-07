import { HeadphoneOff, Headphones, Mic, MicOff, Settings } from 'lucide-react';
import { Avatar, IconButton, ROTULOS_STATUS } from '../components/ui';
import { StatusPicker } from '../features/profile/StatusPicker';
import type { SettableStatus } from '../types/concord-api';

/**
 * Painel do proprio usuario no rodape da coluna de canais: avatar com status
 * (clique para trocar), microfone, fone e configuracoes.
 */
export function UserPanel({
  name,
  userKey,
  avatar,
  status,
  onStatusChange,
  peers,
  networkError,
  version,
  inCall,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onOpenSettings,
}: {
  name: string;
  userKey: string;
  avatar: string | null;
  status: SettableStatus;
  onStatusChange: (s: SettableStatus) => void;
  peers: number;
  networkError: boolean;
  version: string | null;
  inCall: boolean;
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onOpenSettings: () => void;
}) {
  const corRede = networkError
    ? 'bg-status-dnd'
    : peers > 0
      ? 'bg-status-online'
      : 'bg-status-offline';

  return (
    <footer className="flex h-[58px] shrink-0 items-center gap-1 bg-void-850 px-2">
      <StatusPicker
        status={status}
        onChange={onStatusChange}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-0.5 pr-2 text-left transition hover:bg-void-700"
      >
        <Avatar
          name={name}
          userKey={userKey}
          src={avatar}
          size={34}
          status={status}
          statusBorder="border-void-850"
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-ink-100">{name}</span>
          <span
            className="flex items-center gap-1 truncate text-xs text-ink-400"
            title={
              (networkError ? 'Sem conexao com a rede' : `${peers} peers conectados`) +
              (version ? ` · Concord v${version}` : '')
            }
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${corRede}`} />
            {ROTULOS_STATUS[status]}
            <span className="text-ink-400/80">
              · {networkError ? 'offline' : `${peers} ${peers === 1 ? 'peer' : 'peers'}`}
            </span>
          </span>
        </span>
      </StatusPicker>

      <IconButton
        label={
          !inCall ? 'Entre num canal de voz' : muted ? 'Ativar microfone' : 'Desativar microfone'
        }
        onClick={onToggleMute}
        disabled={!inCall}
        className={muted && inCall ? 'text-status-dnd hover:text-status-dnd' : ''}
      >
        {muted && inCall ? (
          <MicOff className="h-[18px] w-[18px]" />
        ) : (
          <Mic className="h-[18px] w-[18px]" />
        )}
      </IconButton>
      <IconButton
        label={!inCall ? 'Entre num canal de voz' : deafened ? 'Ativar audio' : 'Desativar audio'}
        onClick={onToggleDeafen}
        disabled={!inCall}
        className={deafened && inCall ? 'text-status-dnd hover:text-status-dnd' : ''}
      >
        {deafened && inCall ? (
          <HeadphoneOff className="h-[18px] w-[18px]" />
        ) : (
          <Headphones className="h-[18px] w-[18px]" />
        )}
      </IconButton>
      <IconButton label="Configuracoes" onClick={onOpenSettings}>
        <Settings className="h-[18px] w-[18px]" />
      </IconButton>
    </footer>
  );
}
