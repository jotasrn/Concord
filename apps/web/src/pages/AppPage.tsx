import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Hash, LogIn, Plus, Radio, Send, Settings, Share2, UserPlus, Volume2 } from 'lucide-react';
import { Avatar, Button, ErrorBanner, Input } from '../components/ui';
import { AudioSettingsPanel } from '../features/voice/AudioSettingsPanel';
import { PromptModal, PromptRequest } from '../components/PromptModal';
import { CallPanel } from '../features/voice/CallPanel';
import { CallStage } from '../features/voice/CallStage';
import { ScreenViewer } from '../features/screenshare/ScreenViewer';
import { SourcePicker } from '../features/screenshare/SourcePicker';
import type { CaptureSource } from '../features/screenshare/ScreenShareEngine';
import type { ScreenQuality } from '../features/screenshare/presets';
import { useVoiceCall } from '../features/voice/useVoiceCall';
import { sounds } from '../features/voice/audio/SoundEffects';
import type { ChannelView, MemberView, MessageView, Profile, ServerView } from '../types/concord-api';

export function AppPage({ profile }: { profile: Profile }) {
  const [servers, setServers] = useState<ServerView[]>([]);
  const [activeServer, setActiveServer] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [draft, setDraft] = useState('');
  const [peers, setPeers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [picker, setPicker] = useState<'novo' | 'trocar' | null>(null);
  // Ao entrar numa chamada o palco assume a area principal; a aba deixa voltar
  // para o chat sem sair da call.
  const [aba, setAba] = useState<'chat' | 'call'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  const memberNames = new Map(members.map((m) => [m.userKey, m.displayName]));
  const call = useVoiceCall(activeServer, memberNames);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : 'Erro inesperado');

  const loadServers = useCallback(async () => {
    try {
      const list = await window.concord.servers.list();
      setServers(list);
      setActiveServer((current) => current ?? list[0]?.id ?? null);
    } catch (e) {
      report(e);
    }
  }, []);

  const loadServerContent = useCallback(async (serverId: string) => {
    try {
      const [chans, mems] = await Promise.all([
        window.concord.channels.list(serverId),
        window.concord.members.list(serverId),
      ]);
      setChannels(chans);
      setMembers(mems);
      setActiveChannel((current) =>
        current && chans.some((c) => c.id === current)
          ? current
          : (chans.find((c) => c.type === 'TEXT')?.id ?? null),
      );
    } catch (e) {
      report(e);
    }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    try {
      setMessages(await window.concord.messages.list(channelId, 100));
    } catch (e) {
      report(e);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    if (activeServer) void loadServerContent(activeServer);
  }, [activeServer, loadServerContent]);

  useEffect(() => {
    if (activeChannel) void loadMessages(activeChannel);
  }, [activeChannel, loadMessages]);

  // Operacoes chegaram de um peer: recarrega o que estiver na tela.
  useEffect(() => {
    return window.concord.onSyncUpdate((serverId) => {
      void loadServers();
      if (serverId === activeServer) {
        void loadServerContent(serverId);
        if (activeChannel) {
          void loadMessages(activeChannel);
          sounds.play('message');
        }
      }
    });
  }, [activeServer, activeChannel, loadServers, loadServerContent, loadMessages]);

  useEffect(() => {
    const tick = () =>
      void window.concord.network
        .status()
        .then((s) => setPeers(s.peers))
        .catch(() => undefined);
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function createServer() {
    setPrompt({
      title: 'Criar servidor',
      fields: [{ name: 'name', label: 'Nome', placeholder: 'Ex: Squad' }],
      confirmLabel: 'Criar',
      onSubmit: async ({ name }) => {
        try {
          const id = await window.concord.servers.create(name.trim());
          await loadServers();
          setActiveServer(id);
        } catch (e) {
          report(e);
        }
      },
    });
  }

  function createChannel(type: 'TEXT' | 'VOICE') {
    if (!activeServer) return;
    setPrompt({
      title: `Criar canal de ${type === 'TEXT' ? 'texto' : 'voz'}`,
      fields: [{ name: 'name', label: 'Nome', placeholder: 'Ex: geral' }],
      confirmLabel: 'Criar',
      onSubmit: async ({ name }) => {
        try {
          await window.concord.channels.create(activeServer, name.trim(), type);
          await loadServerContent(activeServer);
        } catch (e) {
          report(e);
        }
      },
    });
  }

  function addMember() {
    if (!activeServer) return;
    setPrompt({
      title: 'Adicionar amigo',
      description:
        'Peca a chave publica dele (fica em Configuracoes > Minha conta) e cole aqui.',
      fields: [
        { name: 'key', label: 'Chave publica', placeholder: '64 caracteres hex', multiline: true },
        { name: 'nome', label: 'Nome', placeholder: 'Como ele aparece na lista' },
      ],
      confirmLabel: 'Adicionar',
      onSubmit: async ({ key, nome }) => {
        try {
          await window.concord.members.add(activeServer, key.trim(), nome.trim() || 'amigo');
          await loadServerContent(activeServer);
        } catch (e) {
          report(e);
        }
      },
    });
  }

  function criarConvite() {
    if (!activeServer) return;
    void window.concord.invites
      .create(activeServer)
      .then((codigo) => {
        void navigator.clipboard.writeText(codigo);
        sounds.play('success');
        setPrompt({
          title: 'Convite copiado',
          description:
            'Ja esta na area de transferencia. Quem receber consegue LER o historico; para escrever, adicione a chave publica dele nos membros.',
          fields: [{ name: 'codigo', label: 'Codigo', multiline: true }],
          confirmLabel: 'Fechar',
          onSubmit: () => undefined,
        });
      })
      .catch(report);
  }

  function entrarPorConvite() {
    setPrompt({
      title: 'Entrar com convite',
      description: 'Cole o codigo que seu amigo gerou.',
      fields: [{ name: 'codigo', label: 'Codigo do convite', multiline: true }],
      confirmLabel: 'Entrar',
      onSubmit: async ({ codigo }) => {
        try {
          const id = await window.concord.invites.accept(codigo.trim());
          sounds.play('success');
          await loadServers();
          setActiveServer(id);
        } catch (e) {
          sounds.play('error');
          report(e);
        }
      },
    });
  }

  async function send() {
    if (!activeServer || !activeChannel || !draft.trim()) return;
    const content = draft;
    setDraft('');
    try {
      await window.concord.messages.send(activeServer, activeChannel, content);
      await loadMessages(activeChannel);
    } catch (e) {
      report(e);
      setDraft(content);
    }
  }

  const currentServer = servers.find((s) => s.id === activeServer) ?? null;
  const currentChannel = channels.find((c) => c.id === activeChannel) ?? null;
  const textChannels = channels.filter((c) => c.type === 'TEXT');
  const voiceChannels = channels.filter((c) => c.type === 'VOICE');

  return (
    <div className="flex h-full bg-void-950">
      {/* Trilha de servidores */}
      <nav className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-void-800 bg-void-900 py-3">
        {servers.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveServer(s.id)}
            title={s.name}
            className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold transition-all ${
              s.id === activeServer
                ? 'rounded-xl bg-violet-600 text-white shadow-glow'
                : 'bg-void-700 text-ink-200 hover:rounded-xl hover:bg-violet-700 hover:text-white'
            }`}
          >
            {s.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
        <button
          onClick={entrarPorConvite}
          title="Entrar com um convite"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-void-500 text-ink-300 transition hover:border-violet-500 hover:text-violet-400"
        >
          <LogIn className="h-5 w-5" />
        </button>
        <button
          onClick={createServer}
          title="Criar servidor"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-void-500 text-ink-300 transition hover:border-violet-500 hover:text-violet-400"
        >
          <Plus className="h-5 w-5" />
        </button>
      </nav>

      {/* Canais */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-void-800 bg-void-900">
        <header className="flex h-12 items-center border-b border-void-800 px-4">
          <h2 className="flex-1 truncate text-sm font-bold text-ink-100">
            {currentServer?.name ?? 'Nenhum servidor'}
          </h2>
          {currentServer && (
            <button
              onClick={criarConvite}
              title="Gerar convite"
              className="rounded p-1 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
            >
              <Share2 className="h-4 w-4" />
            </button>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-2">
          {currentServer && (
            <>
              <ChannelGroup
                label="Canais de texto"
                onAdd={() => createChannel('TEXT')}
                items={textChannels}
                icon={<Hash className="h-4 w-4" />}
                activeId={activeChannel}
                onSelect={setActiveChannel}
              />
              <ChannelGroup
                label="Canais de voz"
                onAdd={() => createChannel('VOICE')}
                items={voiceChannels}
                icon={<Volume2 className="h-4 w-4" />}
                activeId={call.state.channelId}
                onSelect={(id) => {
                  const canal = voiceChannels.find((c) => c.id === id);
                  if (!canal) return;
                  if (call.state.channelId === id) {
                    // Ja esta neste canal: o clique alterna entre palco e chat.
                    setAba((a) => (a === 'call' ? 'chat' : 'call'));
                  } else {
                    void call.join(id, canal.name, profile.publicKey);
                    setAba('call');
                  }
                }}
              />
            </>
          )}
        </div>

        <CallPanel
          state={call.state}
          selfName={profile.displayName}
          selfKey={profile.publicKey}
          remoteScreens={call.remoteScreens}
          onLeave={() => void call.leave()}
          onToggleMute={call.toggleMute}
          onToggleDeafen={call.toggleDeafen}
          onStartScreenShare={() => setPicker('novo')}
          onStopScreenShare={() => void call.stopScreenShare()}
          onTogglePause={() => void call.toggleScreenPause()}
          onSwitchSource={() => setPicker('trocar')}
        />

        <footer className="flex items-center gap-2 border-t border-void-800 bg-void-850 p-2">
          <Avatar name={profile.displayName} userKey={profile.publicKey} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink-100">{profile.displayName}</p>
            <p className="flex items-center gap-1 text-[10px] text-ink-400">
              <Radio className={`h-2.5 w-2.5 ${peers > 0 ? 'text-status-online' : 'text-status-offline'}`} />
              {peers} {peers === 1 ? 'peer' : 'peers'}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            title="Configuracoes"
            className="rounded p-1.5 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
          >
            <Settings className="h-4 w-4" />
          </button>
        </footer>
      </aside>

      {/* Chat */}
      <main className="flex min-w-0 flex-1 flex-col">
        {aba === 'call' && call.state.channelId ? (
          <CallStage
            state={call.state}
            selfName={profile.displayName}
            selfKey={profile.publicKey}
            remoteScreens={call.remoteScreens}
            onLeave={() => {
              void call.leave();
              setAba('chat');
            }}
            onToggleMute={call.toggleMute}
            onToggleDeafen={call.toggleDeafen}
            onStartScreenShare={() => setPicker('novo')}
            onStopScreenShare={() => void call.stopScreenShare()}
            onTogglePause={() => void call.toggleScreenPause()}
            onSwitchSource={() => setPicker('trocar')}
          />
        ) : (
          <>
        <header className="flex h-12 items-center gap-2 border-b border-void-800 px-4">
          {currentChannel ? (
            <>
              <Hash className="h-4 w-4 text-ink-400" />
              <h3 className="flex-1 text-sm font-semibold text-ink-100">{currentChannel.name}</h3>
            </>
          ) : (
            <span className="flex-1 text-sm text-ink-400">Selecione um canal</span>
          )}
          {call.state.channelId && (
            <button
              onClick={() => setAba('call')}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600/20 px-3 py-1 text-xs font-semibold text-violet-200 transition hover:bg-violet-600/30"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Voltar para a chamada
            </button>
          )}
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && <ErrorBanner message={error} />}
          {currentChannel && messages.length === 0 && (
            <p className="text-sm text-ink-400">
              Nenhuma mensagem em #{currentChannel.name} ainda.
            </p>
          )}
          {messages.map((m) => (
            <article key={m.id} className="flex gap-3">
              <Avatar name={m.authorName || '?'} userKey={m.authorKey} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-violet-300">
                    {m.authorName || m.authorKey.slice(0, 8)}
                  </span>
                  <time className="text-[10px] text-ink-400">
                    {new Date(m.createdAt).toLocaleString('pt-BR')}
                  </time>
                  {m.editedAt && <span className="text-[10px] text-ink-400">(editada)</span>}
                </div>
                <p className="selectable whitespace-pre-wrap break-words text-sm text-ink-200">
                  {m.content}
                </p>
              </div>
            </article>
          ))}
        </div>

        {currentChannel && (
          <div className="flex gap-2 border-t border-void-800 p-3">
            <Input
              value={draft}
              onChange={setDraft}
              placeholder={`Mensagem em #${currentChannel.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button onClick={send} disabled={!draft.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
          </>
        )}
      </main>

      {/* Membros */}
      <aside className="hidden w-56 shrink-0 flex-col border-l border-void-800 bg-void-900 lg:flex">
        <header className="flex h-12 items-center justify-between border-b border-void-800 px-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
            Membros &mdash; {members.length}
          </h3>
          {currentServer && (
            <button
              onClick={addMember}
              title="Adicionar amigo pela chave publica"
              className="rounded p-1 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          )}
        </header>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {members.map((m) => (
            <div key={m.userKey} className="flex items-center gap-2 rounded px-2 py-1.5">
              <Avatar name={m.displayName} userKey={m.userKey} size={28} />
              <span className="truncate text-sm text-ink-200">
                {m.displayName || m.userKey.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      </aside>

      {picker && (
        <SourcePicker
          onCancel={() => setPicker(null)}
          onStart={(source: CaptureSource, quality: ScreenQuality) => {
            const acao = picker === 'trocar' ? call.switchScreenSource : call.startScreenShare;
            setPicker(null);
            void acao(source, quality);
          }}
        />
      )}

      {prompt && <PromptModal request={prompt} onClose={() => setPrompt(null)} />}

      {showSettings && (
        <SettingsModal profile={profile} onClose={() => setShowSettings(false)} />
      )}

      {/* Telas compartilhadas pelos peers: overlay flutuante no canto inferior direito */}
      {/* Flutuante so fora do palco: dentro dele as telas ja aparecem na grade. */}
      {aba !== 'call' && (
        <ScreenViewer remoteScreens={call.remoteScreens} memberNames={memberNames} />
      )}
    </div>
  );
}

function ChannelGroup({
  label,
  items,
  icon,
  activeId,
  onSelect,
  onAdd,
}: {
  label: string;
  items: ChannelView[];
  icon: React.ReactNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</span>
        <button onClick={onAdd} className="text-ink-400 transition hover:text-violet-400">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {items.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
            c.id === activeId
              ? 'bg-violet-600/20 text-violet-200'
              : 'text-ink-300 hover:bg-void-700 hover:text-ink-100'
          }`}
        >
          <span className="text-ink-400">{icon}</span>
          <span className="truncate">{c.name}</span>
        </button>
      ))}
    </section>
  );
}

function SettingsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [tab, setTab] = useState<'conta' | 'audio'>('conta');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="panel flex h-[600px] w-full max-w-3xl overflow-hidden">
        <nav className="w-44 shrink-0 space-y-1 border-r border-void-700 bg-void-850 p-3">
          {(['conta', 'audio'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-full rounded px-3 py-2 text-left text-sm capitalize transition ${
                tab === t ? 'bg-violet-600/20 text-violet-200' : 'text-ink-300 hover:bg-void-700'
              }`}
            >
              {t === 'conta' ? 'Minha conta' : 'Voz e video'}
            </button>
          ))}
          <button onClick={onClose} className="mt-4 w-full rounded px-3 py-2 text-left text-sm text-ink-400 hover:text-ink-100">
            Fechar
          </button>
        </nav>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'conta' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-ink-100">Minha conta</h2>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-ink-400">Handle</p>
                <p className="selectable font-mono text-sm text-violet-300">{profile.handle}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-ink-400">
                  Sua chave publica &mdash; mande para quem for te adicionar
                </p>
                <div className="flex gap-2">
                  <p className="selectable min-w-0 flex-1 break-all rounded-lg border border-void-600 bg-void-850 p-2 font-mono text-[11px] text-ink-200">
                    {profile.publicKey}
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => void navigator.clipboard.writeText(profile.publicKey)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === 'audio' && <AudioSettingsPanel />}
        </div>
      </div>
    </div>
  );
}
