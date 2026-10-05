import { useEffect, useState } from 'react';
import { Crown, MicOff, Pencil, Shield, UserMinus, Volume2 } from 'lucide-react';
import { Avatar, Button, ErrorBanner, Input } from '../../components/ui';
import type { MemberView, PresenceStatus } from '../../types/concord-api';

interface RolePreset {
  id: string;
  label: string;
  description: string;
  permissions: string;
}

/**
 * Painel de moderacao de um membro.
 *
 * Cada acao so aparece quando quem esta olhando tem a permissao correspondente.
 * Isso e conveniencia de interface, nao seguranca: quem decide de verdade e o
 * reducer, que confere a permissao ao aplicar cada operacao vinda da rede.
 */
export function MemberMenu({
  serverId,
  member,
  presenca,
  souDono,
  ehDono,
  possoGerenciar,
  possoExpulsar,
  onClose,
  onChanged,
}: {
  serverId: string;
  member: MemberView;
  presenca: PresenceStatus;
  souDono: boolean;
  ehDono: boolean;
  possoGerenciar: boolean;
  possoExpulsar: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [presets, setPresets] = useState<RolePreset[]>([]);
  const [apelido, setApelido] = useState(member.nickname ?? '');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarExpulsao, setConfirmarExpulsao] = useState(false);

  useEffect(() => {
    void window.concord.members
      .roles()
      .then((r) => setPresets(r.presets))
      .catch(() => undefined);
  }, []);

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    setError(null);
    try {
      await acao();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel aplicar');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/80 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel w-full max-w-sm space-y-5 p-5">
        <header className="flex items-center gap-3">
          <Avatar
            name={member.displayName}
            userKey={member.userKey}
            src={member.avatar}
            size={48}
            status={presenca}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink-100">
              {member.displayName}
              {ehDono && <Crown className="h-3.5 w-3.5 shrink-0 text-status-idle" />}
            </p>
            {/* Mostra o nome real quando ha apelido, para nao esconder quem e. */}
            {member.nickname && (
              <p className="truncate text-[11px] text-ink-400">perfil: {member.profileName}</p>
            )}
            <p className="truncate font-mono text-[10px] text-ink-400">
              #{member.userKey.slice(0, 12)}
            </p>
          </div>
        </header>

        {member.bio && <p className="text-xs text-ink-300">{member.bio}</p>}
        <ErrorBanner message={error} />

        {/* Apelido */}
        <section className="space-y-2">
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
            <Pencil className="h-3.5 w-3.5" /> Apelido neste servidor
          </label>
          <div className="flex gap-2">
            <Input
              value={apelido}
              onChange={setApelido}
              placeholder={member.profileName}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                void executar(() =>
                  window.concord.members.nick(serverId, member.userKey, apelido.trim() || null),
                )
              }
            />
            <Button
              disabled={ocupado || apelido === (member.nickname ?? '')}
              onClick={() =>
                void executar(() =>
                  window.concord.members.nick(serverId, member.userKey, apelido.trim() || null),
                )
              }
            >
              Salvar
            </Button>
          </div>
          <p className="text-[11px] text-ink-400">
            Deixe vazio para usar o nome que a pessoa definiu no perfil dela.
          </p>
        </section>

        {/* Cargo */}
        {possoGerenciar && !ehDono && (
          <section className="space-y-2 border-t border-void-700 pt-4">
            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
              <Shield className="h-3.5 w-3.5" /> Cargo
            </label>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  title={p.description}
                  disabled={ocupado || (p.id === 'admin' && !souDono)}
                  onClick={() =>
                    void executar(() =>
                      window.concord.members.role(serverId, member.userKey, p.permissions, p.label),
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    member.roleName === p.label
                      ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                      : 'border-void-600 text-ink-300 hover:border-violet-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {!souDono && (
              <p className="text-[11px] text-ink-400">
                Somente o dono do servidor concede Administrador.
              </p>
            )}
          </section>
        )}

        {/* Acoes */}
        {(possoGerenciar || possoExpulsar) && !ehDono && (
          <section className="space-y-2 border-t border-void-700 pt-4">
            {possoGerenciar && (
              <button
                disabled={ocupado}
                onClick={() =>
                  void executar(() =>
                    window.concord.members.mute(serverId, member.userKey, !member.muted),
                  )
                }
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  member.muted
                    ? 'bg-status-dnd/15 text-status-dnd hover:bg-status-dnd/25'
                    : 'text-ink-200 hover:bg-void-700'
                }`}
              >
                {member.muted ? (
                  <>
                    <Volume2 className="h-4 w-4" /> Remover silenciamento
                  </>
                ) : (
                  <>
                    <MicOff className="h-4 w-4" /> Silenciar no servidor
                  </>
                )}
              </button>
            )}

            {possoExpulsar &&
              (confirmarExpulsao ? (
                <div className="space-y-2 rounded-lg border border-status-dnd/40 bg-status-dnd/10 p-3">
                  <p className="text-xs text-status-dnd">
                    Expulsar {member.displayName}? Ele perde o acesso de escrita na hora.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={ocupado}
                      onClick={() =>
                        void executar(async () => {
                          await window.concord.members.kick(serverId, member.userKey);
                          onClose();
                        })
                      }
                    >
                      Confirmar
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmarExpulsao(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmarExpulsao(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-status-dnd transition hover:bg-status-dnd/15"
                >
                  <UserMinus className="h-4 w-4" /> Expulsar do servidor
                </button>
              ))}
          </section>
        )}

        {/*
          Ponto honesto: sem servidor central nao ha como apagar a copia que ja
          esta na maquina de quem foi expulso.
        */}
        {possoExpulsar && !ehDono && (
          <p className="text-[11px] text-ink-400">
            Expulsar impede novas mensagens dele. O historico que ele ja baixou continua no
            computador dele &mdash; sem servidor central, nao ha como apagar de la.
          </p>
        )}

        <div className="flex justify-end border-t border-void-700 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
