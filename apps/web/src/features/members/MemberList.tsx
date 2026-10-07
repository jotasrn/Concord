import { Crown, MicOff, UserPlus, Volume2 } from 'lucide-react';
import { Avatar, Tooltip } from '../../components/ui';
import type { MemberView, PresenceStatus } from '../../types/concord-api';

/**
 * Lista de membros a direita, separada em Online e Offline como no Discord.
 * Clicar em alguem abre o perfil com as opcoes de moderacao.
 */
export function MemberList({
  members,
  ownerKey,
  presenceOf,
  voiceChannelOf,
  isSpeaking,
  onOpen,
  onAdd,
}: {
  members: MemberView[];
  ownerKey: string | null;
  presenceOf: (userKey: string) => PresenceStatus;
  voiceChannelOf: (userKey: string) => string | null;
  isSpeaking: (userKey: string) => boolean;
  onOpen: (userKey: string) => void;
  onAdd: (() => void) | null;
}) {
  const porNome = (a: MemberView, b: MemberView) =>
    (a.displayName || a.userKey).localeCompare(b.displayName || b.userKey, 'pt-BR');
  const online = members.filter((m) => presenceOf(m.userKey) !== 'OFFLINE').sort(porNome);
  const offline = members.filter((m) => presenceOf(m.userKey) === 'OFFLINE').sort(porNome);

  const grupo = (titulo: string, lista: MemberView[], apagado: boolean) =>
    lista.length > 0 && (
      <section key={titulo}>
        <h3 className="px-2 pb-1 pt-5 text-[11px] font-bold uppercase tracking-wide text-ink-400 first:pt-0">
          {titulo} &mdash; {lista.length}
        </h3>
        {lista.map((m) => {
          const presenca = presenceOf(m.userKey);
          const falando = isSpeaking(m.userKey);
          const emVoz = voiceChannelOf(m.userKey);
          const subtitulo = m.roleName && m.roleName !== 'Membro' ? m.roleName : (m.bio ?? null);
          return (
            <button
              key={m.userKey}
              onClick={() => onOpen(m.userKey)}
              title={m.bio ?? 'Ver perfil e opcoes'}
              className={`group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-void-700 ${
                apagado ? 'opacity-40 hover:opacity-100' : ''
              }`}
            >
              <Avatar
                name={m.displayName}
                userKey={m.userKey}
                src={m.avatar}
                size={32}
                status={presenca}
                speaking={falando}
                statusBorder="border-void-900 group-hover:border-void-700"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-[15px] font-medium text-ink-200 group-hover:text-ink-100">
                  <span className="truncate">{m.displayName || m.userKey.slice(0, 8)}</span>
                  {m.userKey === ownerKey && (
                    <span title="Dono do servidor">
                      <Crown className="h-3.5 w-3.5 shrink-0 text-status-idle" />
                    </span>
                  )}
                </p>
                {subtitulo && (
                  <p
                    className={`truncate text-xs ${
                      m.roleName && m.roleName !== 'Membro' ? 'text-violet-400' : 'text-ink-400'
                    }`}
                  >
                    {subtitulo}
                  </p>
                )}
              </div>
              {emVoz && (
                <span title="Em uma chamada de voz">
                  <Volume2 className="h-4 w-4 shrink-0 text-violet-400" />
                </span>
              )}
              {m.muted && (
                <span title="Silenciado no servidor">
                  <MicOff className="h-4 w-4 shrink-0 text-status-dnd" />
                </span>
              )}
            </button>
          );
        })}
      </section>
    );

  return (
    <aside aria-label="Membros" className="hidden w-60 shrink-0 flex-col bg-void-900 lg:flex">
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4 pt-4">
        {onAdd && (
          <Tooltip label="Adicionar alguem pela chave publica" className="mb-3">
            <button
              onClick={onAdd}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-ink-300 transition hover:bg-void-700 hover:text-ink-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-void-700 text-violet-400">
                <UserPlus className="h-4 w-4" />
              </span>
              Adicionar membro
            </button>
          </Tooltip>
        )}
        {grupo('Online', online, false)}
        {grupo('Offline', offline, true)}
        {members.length === 0 && <p className="px-2 text-sm text-ink-400">Ninguem por aqui.</p>}
      </div>
    </aside>
  );
}
