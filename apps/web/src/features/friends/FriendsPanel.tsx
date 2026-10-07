import { useState } from 'react';
import {
  Check,
  Copy,
  MoreVertical,
  Phone,
  Send,
  Server,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar, ErrorBanner, IconButton, Popover, ROTULOS_STATUS } from '../../components/ui';
import type { Friend, PresenceStatus, ServerView } from '../../types/concord-api';

type Aba = 'online' | 'todos' | 'pendentes' | 'adicionar';

const nomeDe = (f: Friend) => f.displayName || `#${f.userKey.slice(0, 8)}`;

/**
 * Tela inicial de amigos, no estilo da pagina "Amigos" do Discord: abas
 * Online / Todos / Pendentes e o formulario de adicionar pela chave publica.
 */
export function FriendsPanel({
  friends,
  myKey,
  servers,
  presencaDe,
  onReload,
  onCall,
}: {
  friends: Friend[];
  myKey: string;
  servers: ServerView[];
  presencaDe: (userKey: string) => PresenceStatus;
  onReload: () => Promise<void> | void;
  /** Liga direto para o amigo, fora de qualquer servidor. */
  onCall: (userKey: string, displayName: string, avatar: string | null) => void;
}) {
  const [aba, setAba] = useState<Aba>('online');
  const [chave, setChave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [menuConvite, setMenuConvite] = useState<{
    userKey: string;
    anchor: { x: number; y: number };
  } | null>(null);

  const aceitos = friends.filter((f) => f.state === 'ACCEPTED');
  const online = aceitos.filter((f) => presencaDe(f.userKey) !== 'OFFLINE');
  const pendentes = friends.filter((f) => f.state !== 'ACCEPTED');
  const recebidos = pendentes.filter((f) => f.state === 'PENDING_IN').length;

  async function acao(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel concluir');
    }
  }

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
      await onReload();
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

  const lista = aba === 'online' ? online : aba === 'todos' ? aceitos : pendentes;
  const tituloLista =
    aba === 'online'
      ? `Online — ${online.length}`
      : aba === 'todos'
        ? `Todos os amigos — ${aceitos.length}`
        : `Pendentes — ${pendentes.length}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-void-950/80 px-4 shadow-[0_1px_0_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-2 text-ink-100">
          <Users className="h-5 w-5 text-ink-400" />
          <h2 className="text-base font-bold">Amigos</h2>
        </div>
        <span className="h-6 w-px bg-void-600" />
        <nav className="flex items-center gap-2" aria-label="Filtro de amigos">
          <AbaBotao ativo={aba === 'online'} onClick={() => setAba('online')}>
            Online
          </AbaBotao>
          <AbaBotao ativo={aba === 'todos'} onClick={() => setAba('todos')}>
            Todos
          </AbaBotao>
          <AbaBotao ativo={aba === 'pendentes'} onClick={() => setAba('pendentes')}>
            Pendentes
            {recebidos > 0 && (
              <span className="ml-1.5 rounded-full bg-status-dnd px-1.5 text-[11px] font-bold text-white">
                {recebidos}
              </span>
            )}
          </AbaBotao>
          <button
            onClick={() => setAba('adicionar')}
            className={`rounded-md px-2.5 py-0.5 text-sm font-semibold transition ${
              aba === 'adicionar'
                ? 'bg-transparent text-status-online'
                : 'bg-status-online text-void-950 hover:brightness-110'
            }`}
          >
            Adicionar amigo
          </button>
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(error || aviso) && (
          <div className="space-y-2 px-8 pt-4">
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
            {aviso && (
              <p className="flex items-start gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
                <span className="flex-1">{aviso}</span>
                <button
                  onClick={() => setAviso(null)}
                  aria-label="Fechar aviso"
                  className="shrink-0 rounded p-0.5 text-violet-200/70 hover:text-violet-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </p>
            )}
          </div>
        )}

        {aba === 'adicionar' ? (
          <div className="space-y-8 px-8 py-6">
            <section className="space-y-2">
              <h3 className="text-base font-bold uppercase text-ink-100">Adicionar amigo</h3>
              <p className="text-sm text-ink-300">
                Cole a chave publica da pessoa (64 caracteres). O pedido viaja direto entre os dois
                dispositivos, sem servidor no meio.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-void-950 bg-void-950 py-2 pl-4 pr-2 focus-within:border-violet-500">
                <input
                  value={chave}
                  onChange={(e) => setChave(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && chave.trim().length === 64 && void enviarPedido()
                  }
                  placeholder="Chave publica - 64 caracteres hex"
                  aria-label="Chave publica do amigo"
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink-100 placeholder:font-sans placeholder:text-ink-400 focus:outline-hidden"
                />
                <button
                  onClick={() => void enviarPedido()}
                  disabled={enviando || chave.trim().length !== 64}
                  className="btn-primary shrink-0 py-1.5"
                >
                  <UserPlus className="h-4 w-4" />
                  {enviando ? 'Enviando...' : 'Enviar pedido'}
                </button>
              </div>
              {chave.trim().length > 0 && chave.trim().length !== 64 && (
                <p className="text-xs text-status-idle">{chave.trim().length}/64 caracteres</p>
              )}
            </section>

            <section className="space-y-2 border-t border-void-600 pt-6">
              <h3 className="label-caps">Sua chave publica</h3>
              <p className="text-sm text-ink-300">
                Mande para quem quiser te adicionar. Ela identifica voce na rede - nao e senha.
              </p>
              <div className="flex items-center gap-2 rounded-lg bg-void-900 p-2 pl-4">
                <code className="selectable min-w-0 flex-1 truncate font-mono text-xs text-ink-200">
                  {myKey}
                </code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(myKey);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 1500);
                  }}
                  className="btn-secondary shrink-0 py-1.5"
                >
                  {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiado ? 'Copiada' : 'Copiar'}
                </button>
              </div>
            </section>

            <p className="flex items-start gap-2 text-xs text-ink-400">
              <Send className="mt-0.5 h-3 w-3 shrink-0" />
              Se a pessoa estiver offline, o pedido fica na fila e sai quando ela abrir o app - com
              os dois online ao mesmo tempo.
            </p>
          </div>
        ) : (
          <div className="px-6 py-4">
            <h3 className="label-caps px-2 pb-2">{tituloLista}</h3>

            {lista.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-void-700">
                  <Users className="h-9 w-9 text-ink-400" />
                </div>
                <p className="max-w-xs text-sm text-ink-400">
                  {aba === 'online'
                    ? 'Nenhum amigo online agora.'
                    : aba === 'todos'
                      ? 'Nenhum amigo ainda. Que tal adicionar alguem?'
                      : 'Nenhum pedido pendente.'}
                </p>
                {aba !== 'pendentes' && (
                  <button onClick={() => setAba('adicionar')} className="btn-primary">
                    Adicionar amigo
                  </button>
                )}
              </div>
            )}

            <ul>
              {lista.map((f) => {
                const presenca = presencaDe(f.userKey);
                const pendente = f.state !== 'ACCEPTED';
                return (
                  <li
                    key={f.userKey}
                    className="group flex items-center gap-3 rounded-lg border-t border-void-700 px-2 py-2.5 transition first:border-transparent hover:border-transparent hover:bg-void-700 [&:hover+li]:border-transparent"
                  >
                    <Avatar
                      name={f.displayName}
                      userKey={f.userKey}
                      src={f.avatar}
                      size={36}
                      status={pendente ? undefined : presenca}
                      statusBorder="border-void-800 group-hover:border-void-700"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-1.5 truncate">
                        <span className="truncate font-semibold text-ink-100">{nomeDe(f)}</span>
                        <span className="hidden font-mono text-xs text-ink-400 group-hover:inline">
                          #{f.userKey.slice(0, 8)}
                        </span>
                      </p>
                      <p className="truncate text-xs text-ink-400">
                        {f.state === 'PENDING_IN'
                          ? 'Pedido de amizade recebido'
                          : f.state === 'PENDING_OUT'
                            ? 'Pedido de amizade enviado'
                            : ROTULOS_STATUS[presenca]}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {f.state === 'PENDING_IN' && (
                        <>
                          <Acao
                            label="Aceitar"
                            tom="ok"
                            onClick={() =>
                              void acao(() => window.concord.friends.respond(f.userKey, true))
                            }
                          >
                            <Check className="h-5 w-5" />
                          </Acao>
                          <Acao
                            label="Recusar"
                            tom="perigo"
                            onClick={() =>
                              void acao(() => window.concord.friends.respond(f.userKey, false))
                            }
                          >
                            <X className="h-5 w-5" />
                          </Acao>
                        </>
                      )}
                      {f.state === 'PENDING_OUT' && (
                        <Acao
                          label="Cancelar pedido"
                          tom="perigo"
                          onClick={() => void acao(() => window.concord.friends.remove(f.userKey))}
                        >
                          <X className="h-5 w-5" />
                        </Acao>
                      )}
                      {!pendente && (
                        <>
                          <Acao
                            label={
                              presenca === 'OFFLINE'
                                ? 'Offline - nao da para ligar agora'
                                : `Ligar para ${nomeDe(f)}`
                            }
                            disabled={presenca === 'OFFLINE'}
                            onClick={() => onCall(f.userKey, nomeDe(f), f.avatar)}
                          >
                            <Phone className="h-[18px] w-[18px]" />
                          </Acao>
                          <Acao
                            label="Mais opcoes"
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setMenuConvite({
                                userKey: f.userKey,
                                anchor: { x: r.left - 180, y: r.bottom + 4 },
                              });
                            }}
                          >
                            <MoreVertical className="h-[18px] w-[18px]" />
                          </Acao>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {menuConvite && (
        <Popover anchor={menuConvite.anchor} onClose={() => setMenuConvite(null)} className="w-56">
          {servers.length > 0 && (
            <>
              <p className="label-caps px-2 pb-1 pt-1">Convidar para servidor</p>
              {servers.map((s) => (
                <button
                  key={s.id}
                  className="menu-item"
                  onClick={() => {
                    const alvo = menuConvite.userKey;
                    setMenuConvite(null);
                    void convidar(alvo, s.id);
                  }}
                >
                  <Server className="h-4 w-4 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
              <div className="mx-2 my-1 h-px bg-void-600" />
            </>
          )}
          <button
            className="menu-item text-status-dnd hover:bg-status-dnd!"
            onClick={() => {
              const alvo = menuConvite.userKey;
              setMenuConvite(null);
              void acao(() => window.concord.friends.remove(alvo));
            }}
          >
            <Trash2 className="h-4 w-4" />
            Remover amigo
          </button>
        </Popover>
      )}
    </div>
  );
}

function AbaBotao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-md px-2.5 py-0.5 text-sm font-medium transition ${
        ativo ? 'bg-void-600 text-ink-100' : 'text-ink-300 hover:bg-void-700 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}

function Acao({
  label,
  onClick,
  children,
  tom,
  disabled,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  tom?: 'ok' | 'perigo';
  disabled?: boolean;
}) {
  return (
    <IconButton
      label={label}
      onClick={onClick}
      disabled={disabled}
      className={`h-9! w-9! rounded-full! bg-void-900 group-hover:bg-void-950 ${
        tom === 'ok'
          ? 'text-status-online! hover:text-status-online!'
          : tom === 'perigo'
            ? 'hover:text-status-dnd!'
            : ''
      }`}
    >
      {children}
    </IconButton>
  );
}

/**
 * Coluna esquerda da tela inicial: atalho para Amigos e quem esta online,
 * com ligacao rapida.
 */
export function FriendsSidebar({
  friends,
  presencaDe,
  pendingCount,
  onCall,
}: {
  friends: Friend[];
  presencaDe: (userKey: string) => PresenceStatus;
  pendingCount: number;
  onCall: (userKey: string, displayName: string, avatar: string | null) => void;
}) {
  const online = friends.filter(
    (f) => f.state === 'ACCEPTED' && presencaDe(f.userKey) !== 'OFFLINE',
  );
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-void-950/80 px-4 shadow-[0_1px_0_rgba(0,0,0,0.4)]">
        <h2 className="text-[15px] font-bold text-ink-100">Inicio</h2>
      </header>
      <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        <div className="flex w-full items-center gap-3 rounded-md bg-void-600 px-3 py-2.5 text-[15px] font-medium text-ink-100">
          <Users className="h-5 w-5" />
          <span className="flex-1">Amigos</span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-status-dnd px-1.5 text-[11px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </div>

        <h3 className="px-2 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wide text-ink-400">
          Online agora &mdash; {online.length}
        </h3>
        {online.length === 0 && <p className="px-2 text-xs text-ink-400">Nenhum amigo online.</p>}
        {online.map((f) => (
          <div
            key={f.userKey}
            className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-void-700"
          >
            <Avatar
              name={f.displayName}
              userKey={f.userKey}
              src={f.avatar}
              size={32}
              status={presencaDe(f.userKey)}
              statusBorder="border-void-900 group-hover:border-void-700"
            />
            <span className="flex-1 truncate text-[15px] text-ink-300 group-hover:text-ink-100">
              {nomeDe(f)}
            </span>
            <button
              onClick={() => onCall(f.userKey, nomeDe(f), f.avatar)}
              aria-label={`Ligar para ${nomeDe(f)}`}
              title={`Ligar para ${nomeDe(f)}`}
              className="rounded-full p-1.5 text-ink-400 opacity-0 transition group-hover:opacity-100 hover:bg-status-online/20 hover:text-status-online focus-visible:opacity-100"
            >
              <Phone className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
