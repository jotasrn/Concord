import { forwardRef, useEffect, useRef } from 'react';
import { Hash, PlusCircle, SendHorizontal, Users, Volume2 } from 'lucide-react';
import { Avatar, IconButton } from '../../components/ui';
import { MessageText } from '../../components/MessageText';
import type { ChannelView, MessageView } from '../../types/concord-api';

/** Mensagens do mesmo autor dentro desta janela viram um bloco so. */
const JANELA_AGRUPAMENTO_MS = 7 * 60 * 1000;

const mesmoDia = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString();

function horaCurta(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dataRelativa(ts: number) {
  const agora = new Date();
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(ts, agora.getTime())) return `Hoje as ${horaCurta(ts)}`;
  if (mesmoDia(ts, ontem.getTime())) return `Ontem as ${horaCurta(ts)}`;
  return `${new Date(ts).toLocaleDateString('pt-BR')} ${horaCurta(ts)}`;
}

function dataDivisor(ts: number) {
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Cabecalho do canal de texto. */
export function ChatHeader({
  channel,
  inCall,
  membersOpen,
  onBackToCall,
  onToggleMembers,
}: {
  channel: ChannelView | null;
  inCall: boolean;
  membersOpen: boolean;
  onBackToCall: () => void;
  onToggleMembers: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-void-950/80 px-4 shadow-[0_1px_0_rgba(0,0,0,0.35)]">
      {channel ? (
        <>
          <Hash className="h-6 w-6 shrink-0 text-ink-400" />
          <h3 className="shrink-0 text-base font-bold text-ink-100">{channel.name}</h3>
          {channel.topic && (
            <>
              <span className="mx-1 h-6 w-px shrink-0 bg-void-600" />
              <p className="truncate text-sm text-ink-300" title={channel.topic}>
                {channel.topic}
              </p>
            </>
          )}
        </>
      ) : (
        <span className="text-sm text-ink-400">Selecione um canal</span>
      )}
      <div className="flex-1" />
      {inCall && (
        <button
          onClick={onBackToCall}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-status-online/15 px-3 py-1 text-xs font-semibold text-status-online transition hover:bg-status-online/25"
        >
          <Volume2 className="h-3.5 w-3.5" />
          Voltar para a chamada
        </button>
      )}
      <IconButton
        label={membersOpen ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
        onClick={onToggleMembers}
        active={membersOpen}
        side="bottom"
        className="hidden lg:flex"
      >
        <Users className="h-5 w-5" />
      </IconButton>
    </header>
  );
}

/**
 * Lista de mensagens. Mensagens seguidas do mesmo autor sao agrupadas (avatar
 * e nome so na primeira), com divisores de data, como no Discord.
 */
export const MessageList = forwardRef<
  HTMLDivElement,
  {
    channel: ChannelView | null;
    messages: MessageView[];
    authorOf: (authorKey: string, authorName: string) => { nome: string; avatar: string | null };
  }
>(function MessageList({ channel, messages, authorOf }, ref) {
  return (
    <div ref={ref} className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end pb-6">
        {channel && (
          <div className="px-4 pb-4 pt-8">
            <div className="mb-3 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-void-600">
              <Hash className="h-10 w-10 text-ink-100" />
            </div>
            <h2 className="text-3xl font-bold text-ink-100">Bem-vindo(a) a #{channel.name}!</h2>
            <p className="mt-1 text-ink-300">Este e o comeco do canal #{channel.name}.</p>
          </div>
        )}

        {messages.map((m, i) => {
          const anterior = messages[i - 1];
          const novoDia = !anterior || !mesmoDia(anterior.createdAt, m.createdAt);
          const agrupada =
            !novoDia &&
            anterior.authorKey === m.authorKey &&
            m.createdAt - anterior.createdAt < JANELA_AGRUPAMENTO_MS;
          const autor = authorOf(m.authorKey, m.authorName);

          return (
            <div key={m.id}>
              {novoDia && (
                <div className="mx-4 my-4 flex items-center gap-2" role="separator">
                  <span className="h-px flex-1 bg-void-600" />
                  <span className="text-xs font-semibold text-ink-400">
                    {dataDivisor(m.createdAt)}
                  </span>
                  <span className="h-px flex-1 bg-void-600" />
                </div>
              )}

              {agrupada ? (
                <article className="group relative py-0.5 pl-[72px] pr-4 transition-colors hover:bg-void-850/70">
                  <time
                    dateTime={new Date(m.createdAt).toISOString()}
                    title={new Date(m.createdAt).toLocaleString('pt-BR')}
                    className="absolute left-0 top-1 w-[72px] text-center text-[11px] text-ink-400 opacity-0 group-hover:opacity-100"
                  >
                    {horaCurta(m.createdAt)}
                  </time>
                  <MessageText content={m.content} />
                  {m.editedAt && <span className="text-[10px] text-ink-400">(editada)</span>}
                </article>
              ) : (
                <article className="group mt-4 flex gap-4 py-0.5 pl-4 pr-4 transition-colors hover:bg-void-850/70">
                  <div className="pt-0.5">
                    <Avatar name={autor.nome} userKey={m.authorKey} src={autor.avatar} size={40} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold text-violet-300">
                        {autor.nome}
                      </span>
                      <time
                        dateTime={new Date(m.createdAt).toISOString()}
                        title={new Date(m.createdAt).toLocaleString('pt-BR')}
                        className="shrink-0 text-xs text-ink-400"
                      >
                        {dataRelativa(m.createdAt)}
                      </time>
                      {m.editedAt && <span className="text-[10px] text-ink-400">(editada)</span>}
                    </div>
                    <MessageText content={m.content} />
                  </div>
                </article>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Caixa de mensagem. Enter envia; Shift+Enter quebra linha. Cresce com o
 * texto ate um limite e depois rola.
 */
export function Composer({
  channelName,
  value,
  onChange,
  onSend,
}: {
  channelName: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  // Foca a caixa ao trocar de canal, como no Discord. Na primeira montagem
  // nao: o Enter que desbloqueou a conta cairia aqui como quebra de linha.
  const canalAnterior = useRef(channelName);
  useEffect(() => {
    if (canalAnterior.current !== channelName) ref.current?.focus();
    canalAnterior.current = channelName;
  }, [channelName]);

  return (
    <div className="shrink-0 px-4 pb-6">
      <div className="flex items-end gap-2 rounded-lg bg-void-700 px-3">
        <PlusCircle aria-hidden className="mb-3 h-6 w-6 shrink-0 text-ink-400" />
        <textarea
          ref={ref}
          rows={1}
          value={value}
          aria-label={`Mensagem em #${channelName}`}
          placeholder={`Conversar em #${channelName}`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          className="max-h-[220px] min-h-[48px] flex-1 resize-none bg-transparent py-3 focus-visible:ring-0 focus-visible:ring-offset-0 text-[15px] leading-6 text-ink-100 placeholder:text-ink-400 focus:outline-hidden"
        />
        <button
          onClick={onSend}
          disabled={!value.trim()}
          aria-label="Enviar mensagem"
          title="Enviar (Enter)"
          className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-violet-400 transition hover:bg-violet-600 hover:text-white disabled:text-ink-400 disabled:hover:bg-transparent"
        >
          <SendHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
