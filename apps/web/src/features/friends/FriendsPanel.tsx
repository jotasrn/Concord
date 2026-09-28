import { useEffect, useState } from 'react';
import { Clock, Phone, Send, Trash2, UserPlus } from 'lucide-react';
import { Avatar, Button, ErrorBanner, Input } from '../../components/ui';
import type { Friend, PresenceStatus, ServerView } from '../../types/concord-api';

const ROTULO_ESTADO: Record<Friend['state'], string> = {
  ACCEPTED: 'Amigos',
  PENDING_IN: 'Aguardando sua resposta',
  PENDING_OUT: 'Convite enviado',
};

/** Lista de amigos, envio de pedidos e convite de servidor direto. */
export function FriendsPanel({
  servers,
  presencaDe,
  onChanged,
  onCall,
}: {
  servers: ServerView[];
  presencaDe: (userKey: string) => PresenceStatus;
  onChanged: () => void;
  /** Liga direto para o amigo, fora de qualquer servidor. */
  onCall: (userKey: string, displayName: string, avatar: string | null) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [chave, setChave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function recarregar() {
    try {
      setFriends(await window.concord.friends.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel listar');
    }
  }

  useEffect(() => {
    void recarregar();
    return window.concord.onSocialEvent(() => void recarregar());
  }, []);

  async function enviarPedido() {
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const status = await window.concord.friends.request(chave.trim());
      setChave('');
      setAviso(
        status === 'entregue'
          ? 'Pedido ENTREGUE. Ele ja apareceu na tela da pessoa.'
          : 'Pedido na fila: ainda nao encontramos a pessoa na rede. Ele sai sozinho quando ela abrir o app - nao ha servidor guardando recado.',
      );
      await recarregar();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel enviar');
    } finally {
      setEnviando(false);
    }
  }

  async function convidar(userKey: string, serverId: string) {
    setError(null);
    setAviso(null);
    try {
      const status = await window.concord.serverInvites.send(serverId, userKey);
      setAviso(
        status === 'entregue'
          ? 'Convite ENTREGUE.'
          : 'Convite na fila: sai quando a pessoa abrir o app.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel convidar');
    }
  }

  const aceitos = friends.filter((f) => f.state === 'ACCEPTED');
  const pendentes = friends.filter((f) => f.state !== 'ACCEPTED');

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-ink-100">Amigos</h2>
      <ErrorBanner message={error} />
      {aviso && (
        <p className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          {aviso}
        </p>
      )}

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">
          Adicionar pela chave publica
        </label>
        <div className="flex gap-2">
          <Input
            value={chave}
            onChange={setChave}
            placeholder="64 caracteres hex"
            onKeyDown={(e) => e.key === 'Enter' && void enviarPedido()}
          />
          <Button onClick={enviarPedido} disabled={enviando || chave.trim().length !== 64}>
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-ink-400">
          Peca a chave dela em Configuracoes &rarr; Meu perfil. O pedido chega direto no
          dispositivo da pessoa.
        </p>
      </section>

      {pendentes.length > 0 && (
        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-ink-400">Pendentes</label>
          {pendentes.map((f) => (
            <div key={f.userKey} className="flex items-center gap-2 rounded-lg bg-void-850 p-2">
              <Avatar name={f.displayName} userKey={f.userKey} src={f.avatar} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-200">
                  {f.displayName || `#${f.userKey.slice(0, 8)}`}
                </p>
                <p className="flex items-center gap-1 text-[10px] text-ink-400">
                  <Clock className="h-2.5 w-2.5" />
                  {ROTULO_ESTADO[f.state]}
                </p>
              </div>
              {f.state === 'PENDING_IN' && (
                <>
                  <Button
                    onClick={async () => {
                      await window.concord.friends.respond(f.userKey, true);
                      await recarregar();
                      onChanged();
                    }}
                  >
                    Aceitar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await window.concord.friends.respond(f.userKey, false);
                      await recarregar();
                    }}
                  >
                    Recusar
                  </Button>
                </>
              )}
              {f.state === 'PENDING_OUT' && (
                <button
                  title="Cancelar pedido"
                  onClick={async () => {
                    await window.concord.friends.remove(f.userKey);
                    await recarregar();
                  }}
                  className="rounded p-1.5 text-ink-400 transition hover:text-status-dnd"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-ink-400">
          Meus amigos &mdash; {aceitos.length}
        </label>
        {aceitos.length === 0 && (
          <p className="text-sm text-ink-400">Nenhum amigo ainda.</p>
        )}
        {aceitos.map((f) => (
          <div key={f.userKey} className="flex items-center gap-2 rounded-lg bg-void-850 p-2">
            <Avatar
              name={f.displayName}
              userKey={f.userKey}
              src={f.avatar}
              size={32}
              status={presencaDe(f.userKey)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-200">
                {f.displayName || `#${f.userKey.slice(0, 8)}`}
              </p>
              <p className="truncate font-mono text-[10px] text-ink-400">
                #{f.userKey.slice(0, 8)}
              </p>
            </div>

            {presencaDe(f.userKey) !== 'OFFLINE' && (
              <button
                title={`Ligar para ${f.displayName || 'esta pessoa'}`}
                onClick={() => onCall(f.userKey, f.displayName || `#${f.userKey.slice(0, 8)}`, f.avatar)}
                className="rounded-full bg-status-online/15 p-1.5 text-status-online transition hover:bg-status-online/25"
              >
                <Phone className="h-3.5 w-3.5" />
              </button>
            )}

            {servers.length > 0 && (
              <select
                className="field w-36 py-1 text-xs"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void convidar(f.userKey, e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="">Convidar para...</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            <button
              title="Remover amigo"
              onClick={async () => {
                await window.concord.friends.remove(f.userKey);
                await recarregar();
              }}
              className="rounded p-1.5 text-ink-400 transition hover:text-status-dnd"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </section>

      <p className="flex items-start gap-2 text-[11px] text-ink-400">
        <Send className="mt-0.5 h-3 w-3 shrink-0" />
        Pedidos viajam direto entre os dois dispositivos, sem servidor no meio. Se a pessoa
        estiver offline, o pedido fica na fila e sai quando ela abrir o app - com os dois online
        ao mesmo tempo.
      </p>
    </div>
  );
}
