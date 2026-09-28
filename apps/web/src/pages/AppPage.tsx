import { useCallback, useEffect, useRef, useState } from 'react';
import { Hash, LogIn, MicOff, Plus, Radio, Send, Settings, Share2, UserPlus, Volume2 } from 'lucide-react';
import { Avatar, Button, ErrorBanner, InfoBanner, Input } from '../components/ui';
import { MessageText } from '../components/MessageText';
import { PromptModal, PromptRequest } from '../components/PromptModal';
import { CallPanel } from '../features/voice/CallPanel';
import { CallStage } from '../features/voice/CallStage';
import { RequestsPopup } from '../features/friends/RequestsPopup';
import { MemberMenu } from '../features/members/MemberMenu';
import { SettingsModal } from '../features/settings/SettingsModal';
import { UpdateBanner } from '../features/update/UpdateBanner';
import { StatusPicker } from '../features/profile/StatusPicker';
import { ScreenViewer } from '../features/screenshare/ScreenViewer';
import { SourcePicker } from '../features/screenshare/SourcePicker';
import type { CaptureSource } from '../features/screenshare/ScreenShareEngine';
import type { ScreenQuality } from '../features/screenshare/presets';
import { useVoiceCall } from '../features/voice/useVoiceCall';
import { useDirectCall } from '../features/voice/useDirectCall';
import { DirectCallOverlay } from '../features/voice/DirectCallOverlay';
import { useServerData } from '../hooks/useServerData';
import { sounds } from '../features/voice/audio/SoundEffects';
import type {
  Friend,
  PeerPresence,
  PendingInvite,
  PresenceStatus,
  Profile,
  SettableStatus,
  ChannelView,
} from '../types/concord-api';


export function AppPage({ profile }: { profile: Profile }) {
  const [draft, setDraft] = useState('');
  const [peers, setPeers] = useState(0);
  const [networkError, setNetworkError] = useState(false);
  const networkFailsRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [picker, setPicker] = useState<'novo' | 'trocar' | 'novo-dm' | null>(null);
  // Ao entrar numa chamada o palco assume a area principal; a aba deixa voltar
  // para o chat sem sair da call.
  const [aba, setAba] = useState<'chat' | 'call'>('chat');
  // Status proprio nunca e OFFLINE: enquanto o app roda, existe conexao.
  const [status, setStatus] = useState<SettableStatus>('ONLINE');
  const [presencas, setPresencas] = useState<Record<string, PeerPresence>>({});
  const [nomeProprio, setNomeProprio] = useState(profile.displayName);
  const [pedidosAmizade, setPedidosAmizade] = useState<Friend[]>([]);
  const [convitesPendentes, setConvitesPendentes] = useState<PendingInvite[]>([]);
  const [membroAberto, setMembroAberto] = useState<string | null>(null);
  const [versaoApp, setVersaoApp] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const report = (e: unknown) => setError(e instanceof Error ? e.message : 'Erro inesperado');

  const {
    servers,
    channels,
    members,
    messages,
    activeServer,
    activeChannel,
    setActiveServer,
    setActiveChannel,
    loadServers,
    loadServerContent,
    loadMessages,
  } = useServerData(report);


  const memberNames = new Map(members.map((m) => [m.userKey, m.displayName]));
  /**
   * Autor de mensagem resolvido pela lista de membros, nao pelo nome gravado
   * na operacao.
   *
   * A operacao message.create carrega o nome de quem enviou no momento do
   * envio - um retrato congelado. Trocar o apelido depois nao reescreve o
   * passado (e nem deveria: o log e imutavel), entao quem le precisa resolver
   * o nome na hora da renderizacao. Sem isso, o apelido novo aparece na lista
   * de membros e na chamada, mas o chat continua mostrando o antigo.
   */
  const membrosPorChave = new Map(members.map((m) => [m.userKey, m]));
  const autorDaMensagem = (authorKey: string, authorName: string) => {
    const membro = membrosPorChave.get(authorKey);
    return {
      nome: membro?.displayName || authorName || authorKey.slice(0, 8),
      avatar: membro?.avatar ?? null,
    };
  };
  // Silenciados pela moderacao: a chamada aplica isso em quem recebe.
  const silenciados = new Set(members.filter((m) => m.muted).map((m) => m.userKey));
  const call = useVoiceCall(activeServer, memberNames, silenciados);
  /*
   * Uma so chamada por vez. useDirectCall consulta este predicado antes de
   * ligar ou de mostrar um convite recebido - se ja ha uma chamada de
   * servidor em andamento, a nova chamada e recusada sem interromper quem
   * esta ocupado. Trocar de microfone e mixer de audio no meio de uma call
   * ativa causaria disputa entre os dois motores por cima do mesmo hardware.
   */
  const directCall = useDirectCall(profile.publicKey, () => Boolean(call.state.channelId));

  // O proprio perfil sai da lista de membros, que ja vem com avatar e bio.
  const meuMembro = members.find((m) => m.userKey === profile.publicKey);
  const meuAvatar = meuMembro?.avatar ?? null;

  /**
   * Presenca de um membro. Ausencia na lista de peers significa offline: nao
   * ha registro de status para quem nao esta conectado.
   */
  const presencaDe = (userKey: string): PresenceStatus =>
    userKey === profile.publicKey
      ? status
      : ((presencas[userKey]?.status as PresenceStatus | undefined) ?? 'OFFLINE');

  /**
   * Quem esta em cada canal de voz. Vem da presenca dos peers, entao reflete
   * o estado real da rede - nao ha registro no log dizendo quem esta em call.
   */
  const ocupantesDe = (channelId: string) => {
    // So existe leitura real de "quem fala" para quem esta no MESMO canal que
    // nos: e so ai que ha uma RTCPeerConnection direta medindo o audio. Para
    // qualquer outro canal ninguem tem como saber, e speaking fica false -
    // honesto em vez de fingir.
    const falandoPorChave =
      call.state.channelId === channelId
        ? new Map(call.state.participants.map((p) => [p.key, p.speaking]))
        : new Map<string, boolean>();

    const dentro = members
      .filter((m) => presencas[m.userKey]?.voice === channelId)
      .map((m) => ({
        userKey: m.userKey,
        name: m.displayName || m.userKey.slice(0, 8),
        avatar: m.avatar,
        speaking: falandoPorChave.get(m.userKey) ?? false,
      }));

    // O proprio usuario nao vem pela rede: entra a partir do estado local.
    if (call.state.channelId === channelId) {
      dentro.unshift({
        userKey: profile.publicKey,
        name: nomeProprio,
        avatar: meuAvatar,
        speaking: Boolean(call.state.audio?.transmitting) && !call.state.muted,
      });
    }
    return dentro;
  };

  /**
   * Minhas permissoes no servidor atual. Serve so para esconder botoes: quem
   * decide de fato e o reducer ao aplicar a operacao.
   */
  const minhasPermissoes = meuMembro?.permissions ?? '0';
  const temPermissao = (flag: number) => {
    const bits = BigInt(minhasPermissoes);
    if (bits & BigInt(1 << 10)) return true; // ADMINISTRATOR
    return (bits & BigInt(flag)) === BigInt(flag);
  };
  const donoDoServidor = servers.find((s) => s.id === activeServer)?.ownerKey ?? null;
  const souDono = donoDoServidor === profile.publicKey;

  useEffect(() => {
    void window.concord.app.version().then(setVersaoApp).catch(() => undefined);
  }, []);

  useEffect(() => {
    let failCount = 0;
    const tick = () =>
      void window.concord.network
        .status()
        .then((s) => {
          setPeers(s.peers);
          failCount = 0;
          setNetworkError(false);
          networkFailsRef.current = 0;
        })
        .catch(() => {
          failCount += 1;
          networkFailsRef.current = failCount;
          if (failCount >= 3) setNetworkError(true);
        });
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void window.concord.presence
      .get()
      .then((p) => {
        setStatus(p.status as SettableStatus);
        setPresencas(p.peers);
      })
      .catch(() => undefined);
    return window.concord.presence.onUpdate(setPresencas);
  }, []);

  const carregarPendencias = useCallback(async () => {
    try {
      const [amigos, convites] = await Promise.all([
        window.concord.friends.list(),
        window.concord.serverInvites.pending(),
      ]);
      setPedidosAmizade(amigos.filter((f) => f.state === 'PENDING_IN'));
      setConvitesPendentes(convites);
    } catch {
      // Sem pendencias visiveis e melhor que quebrar a tela inteira.
    }
  }, []);

  useEffect(() => {
    void carregarPendencias();
    return window.concord.onSocialEvent((evento) => {
      void carregarPendencias();
      sounds.play(evento === 'friend:response' ? 'success' : 'message');
    });
  }, [carregarPendencias]);

  /**
   * Bolhas flutuantes sobre outros aplicativos.
   *
   * So aparecem quando ha chamada ativa E a janela do Concord nao esta em
   * primeiro plano - dentro do app o palco ja mostra todo mundo, e o overlay
   * seria ruido duplicado.
   */
  useEffect(() => {
    if (!call.state.channelId) {
      void window.concord.overlay.update([], false).catch(() => undefined);
      return;
    }

    const emPrimeiroPlano = () => document.hasFocus();

    const enviar = () => {
      const lista = [
        {
          key: profile.publicKey,
          name: nomeProprio,
          avatar: meuAvatar,
          speaking: Boolean(call.state.audio?.transmitting) && !call.state.muted,
          muted: call.state.muted,
        },
        ...call.state.participants.map((p) => ({
          key: p.key,
          name: p.name,
          avatar: members.find((m) => m.userKey === p.key)?.avatar ?? null,
          speaking: false,
          muted: false,
        })),
      ];
      void window.concord.overlay.update(lista, !emPrimeiroPlano()).catch(() => undefined);
    };

    enviar();
    // Intervalo curto para o anel de quem fala acompanhar a voz.
    const id = setInterval(enviar, 250);
    window.addEventListener('focus', enviar);
    window.addEventListener('blur', enviar);

    return () => {
      clearInterval(id);
      window.removeEventListener('focus', enviar);
      window.removeEventListener('blur', enviar);
      void window.concord.overlay.update([], false).catch(() => undefined);
    };
  }, [
    call.state.channelId,
    call.state.audio?.transmitting,
    call.state.muted,
    call.state.participants,
    members,
    meuAvatar,
    nomeProprio,
    profile.publicKey,
  ]);

  /**
   * Rola para o final da lista de mensagens de forma inteligente:
   * - Sempre rola quando o usuario mesmo enviou (scroll manual via send())
   * - So rola automaticamente se o usuario ja estava perto do fim (<= 120px)
   */
  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
  };

  useEffect(() => {
    if (isNearBottom()) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
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
      title: 'Adicionar ao servidor',
      description:
        'Cole a chave publica da pessoa. Ela recebe o convite na hora se estiver online; se nao, assim que abrir o app.',
      fields: [
        { name: 'key', label: 'Chave publica', placeholder: '64 caracteres hex', multiline: true },
        { name: 'nome', label: 'Nome', placeholder: 'Como ele aparece na lista' },
      ],
      confirmLabel: 'Adicionar',
      onSubmit: async ({ key, nome }) => {
        try {
          const status = await window.concord.members.add(
            activeServer,
            key.trim(),
            nome.trim() || 'amigo',
          );
          await loadServerContent(activeServer);
          sounds.play('success');
          if (status === 'na-fila') {
            setInfo(
              'Adicionado. O convite ficou na fila: a pessoa ainda nao foi encontrada na rede e vai receber quando abrir o app.',
            );
          } else {
            setInfo(null);
          }
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
          fields: [{ name: 'codigo', label: 'Codigo', multiline: true, defaultValue: codigo }],
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
      sounds.play('messageSent');
      await loadMessages(activeChannel);
      // Mensagem propria: sempre rola para o fim independente da posicao.
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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
    <div className="flex h-full flex-col bg-void-950">
      {/* Faixa de atualizacao: ocupa a largura toda, acima de tudo. */}
      <UpdateBanner />

      <div className="flex min-h-0 flex-1">
      {/* Trilha de servidores */}
      <nav className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-void-800 bg-void-900 py-3">
        {servers.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveServer(s.id)}
            title={s.name}
            aria-label={`Servidor: ${s.name}`}
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
          aria-label="Entrar com um convite"
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-void-500 text-ink-300 transition hover:border-violet-500 hover:text-violet-400"
        >
          <LogIn className="h-5 w-5" />
        </button>
        <button
          onClick={createServer}
          title="Criar servidor"
          aria-label="Criar servidor"
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
              aria-label="Gerar convite"
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
                activeId={aba === 'chat' ? activeChannel : null}
                onSelect={(id) => {
                  setActiveChannel(id);
                  /*
                   * Sair do palco da chamada faz parte de clicar num canal de
                   * texto. Sem esta linha, quem esta em call troca de canal sem
                   * ver nada acontecer: o palco continua ocupando a area
                   * principal e as mensagens ficam escondidas atras dele - o
                   * unico jeito de chegar no chat era clicar no canal de voz
                   * para alternar a aba.
                   *
                   * A chamada continua: so a tela volta para o chat.
                   */
                  setAba('chat');
                }}
              />
              <ChannelGroup
                label="Canais de voz"
                onAdd={() => createChannel('VOICE')}
                items={voiceChannels}
                icon={<Volume2 className="h-4 w-4" />}
                activeId={call.state.channelId}
                ocupantes={ocupantesDe}
                onSelect={(id) => {
                  const canal = voiceChannels.find((c) => c.id === id);
                  if (!canal) return;
                  if (call.state.channelId === id) {
                    // Ja esta neste canal: o clique alterna entre palco e chat.
                    setAba((a) => (a === 'call' ? 'chat' : 'call'));
                  } else if (directCall.state.phase !== 'idle') {
                    setError('Encerre a chamada direta antes de entrar num canal de voz.');
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
          peerVolumes={call.peerVolumes}
          onPeerVolume={call.setPeerVolume}
          localMutedKeys={call.localMutedKeys}
          onToggleLocalMute={call.toggleLocalMute}
          pinned={call.pinned}
          onTogglePin={call.togglePin}
          onOpenProfile={(peerKey) => setMembroAberto(peerKey)}
          onLeave={() => void call.leave()}
          onToggleMute={call.toggleMute}
          onToggleDeafen={call.toggleDeafen}
          onStartScreenShare={() => setPicker('novo')}
          onStopScreenShare={() => void call.stopScreenShare()}
          onTogglePause={() => void call.toggleScreenPause()}
          onSwitchSource={() => setPicker('trocar')}
        />

        <footer className="flex items-center gap-2 border-t border-void-800 bg-void-850 p-2">
          <Avatar
            name={nomeProprio}
            userKey={profile.publicKey}
            src={meuAvatar}
            size={32}
            status={status}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-ink-100">{nomeProprio}</p>
            <div className="flex items-center gap-2">
              <StatusPicker
                status={status}
                onChange={(novo: SettableStatus) => {
                  setStatus(novo);
                  void window.concord.presence.set(novo).catch(report);
                }}
              />
              <span
                className="flex items-center gap-1 text-[10px] text-ink-400"
                title={networkError ? 'Sem conexao com a rede' : 'Peers conectados'}
              >
                <Radio
                  className={
                    networkError
                      ? 'h-2.5 w-2.5 text-status-dnd'
                      : peers > 0
                        ? 'h-2.5 w-2.5 text-status-online'
                        : 'h-2.5 w-2.5 text-status-offline'
                  }
                />
                {networkError ? 'offline' : peers}
              </span>
              {versaoApp && (
                <span
                  className="font-mono text-[10px] text-ink-400"
                  title="Versao instalada - o auto-update mantem isso igual em todo mundo"
                >
                  v{versaoApp}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            title="Configuracoes"
            aria-label="Abrir configuracoes"
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
            selfAvatar={meuAvatar}
            remoteScreens={call.remoteScreens}
            peersPausados={call.peersPausados}
            peerVolumes={call.peerVolumes}
            onPeerVolume={call.setPeerVolume}
            localMutedKeys={call.localMutedKeys}
            onToggleLocalMute={call.toggleLocalMute}
            pinned={call.pinned}
            onTogglePin={call.togglePin}
            onOpenProfile={(peerKey) => setMembroAberto(peerKey)}
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
            onReconnect={() => void call.reconnect()}
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
          {info && <InfoBanner message={info} />}
          {currentChannel && messages.length === 0 && (
            <p className="text-sm text-ink-400">
              Nenhuma mensagem em #{currentChannel.name} ainda.
            </p>
          )}
          {messages.map((m) => {
            const autor = autorDaMensagem(m.authorKey, m.authorName);
            return (
            <article key={m.id} className="flex gap-3">
              <Avatar name={autor.nome} userKey={m.authorKey} src={autor.avatar} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-violet-300">{autor.nome}</span>
                  <time className="text-[10px] text-ink-400">
                    {new Date(m.createdAt).toLocaleString('pt-BR')}
                  </time>
                  {m.editedAt && <span className="text-[10px] text-ink-400">(editada)</span>}
                </div>
                <MessageText content={m.content} />
              </div>
            </article>
            );
          })}
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
              title="Adicionar alguem ao servidor"
              className="rounded p-1 text-ink-300 transition hover:bg-void-700 hover:text-violet-400"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          )}
        </header>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {/* Online primeiro: quem esta disponivel agora e o que importa. */}
          {[...members]
            .sort((a, b) => {
              const online = (k: string) => (presencaDe(k) === 'OFFLINE' ? 1 : 0);
              return online(a.userKey) - online(b.userKey);
            })
            .map((m) => {
              const presenca = presencaDe(m.userKey);
              const canalDeVoz = presencas[m.userKey]?.voice ?? null;
              // So temos leitura de audio real de quem esta no MESMO canal
              // que nos - mesma logica de ocupantesDe.
              const falandoAgora =
                call.state.channelId === canalDeVoz &&
                call.state.participants.some((p) => p.key === m.userKey && p.speaking);
              return (
                <button
                  key={m.userKey}
                  onClick={() => setMembroAberto(m.userKey)}
                  title={m.bio ?? 'Ver perfil e opcoes'}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-void-700 ${
                    presenca === 'OFFLINE' ? 'opacity-45' : ''
                  }`}
                >
                  <div className="relative shrink-0">
                    <Avatar
                      name={m.displayName}
                      userKey={m.userKey}
                      src={m.avatar}
                      size={28}
                      status={presenca}
                    />
                    {falandoAgora && (
                      <span className="absolute -inset-0.5 rounded-full ring-2 ring-status-online animate-pulse-ring" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-200">
                      {m.displayName || m.userKey.slice(0, 8)}
                      <span className="ml-1 font-mono text-[10px] text-ink-400">
                        #{m.userKey.slice(0, 4)}
                      </span>
                    </p>
                    {m.roleName && m.roleName !== 'Membro' ? (
                      <p className="truncate text-[10px] text-violet-400">{m.roleName}</p>
                    ) : (
                      m.bio && <p className="truncate text-[10px] text-ink-400">{m.bio}</p>
                    )}
                  </div>
                  {canalDeVoz && (
                    <span title="Em uma chamada de voz">
                      <Volume2 className="h-3 w-3 shrink-0 text-violet-400" />
                    </span>
                  )}
                  {m.muted && (
                    <span title="Silenciado no servidor">
                      <MicOff className="h-3 w-3 shrink-0 text-status-dnd" />
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </aside>

      {membroAberto && activeServer && (() => {
        const alvo = members.find((m) => m.userKey === membroAberto);
        if (!alvo) return null;
        return (
          <MemberMenu
            serverId={activeServer}
            member={alvo}
            presenca={presencaDe(alvo.userKey)}
            souDono={souDono}
            ehDono={alvo.userKey === donoDoServidor}
            possoGerenciar={temPermissao(1 << 7)}
            possoExpulsar={temPermissao(1 << 9)}
            onClose={() => setMembroAberto(null)}
            onChanged={() => void loadServerContent(activeServer)}
          />
        );
      })()}

      {picker && (
        <SourcePicker
          onCancel={() => setPicker(null)}
          onStart={(source: CaptureSource, quality: ScreenQuality) => {
            const modo = picker;
            setPicker(null);
            if (modo === 'novo-dm') void directCall.startScreenShare(source, quality);
            else if (modo === 'trocar') void call.switchScreenSource(source, quality);
            else void call.startScreenShare(source, quality);
          }}
        />
      )}

      {prompt && <PromptModal request={prompt} onClose={() => setPrompt(null)} />}

      {showSettings && (
        <SettingsModal
          profile={profile}
          status={status}
          onClose={() => setShowSettings(false)}
          onProfileSaved={(nome) => {
            setNomeProprio(nome);
            if (activeServer) void loadServerContent(activeServer);
          }}
          servers={servers}
          presencaDe={presencaDe}
          onFriendsChanged={() => void carregarPendencias()}
          onCall={(userKey, displayName, avatar) =>
            void directCall.call(userKey, displayName, avatar)
          }
        />
      )}

      <DirectCallOverlay
        state={directCall.state}
        onAccept={() => void directCall.accept()}
        onDecline={directCall.decline}
        onHangUp={directCall.hangUp}
        onToggleMute={directCall.toggleMute}
        onToggleDeafen={directCall.toggleDeafen}
        onStartScreenShare={() => setPicker('novo-dm')}
        onStopScreenShare={() => void directCall.stopScreenShare()}
        peerVolume={directCall.peerVolume()}
        onPeerVolume={directCall.setPeerVolume}
      />

      {/* Telas compartilhadas pelos peers: overlay flutuante no canto inferior direito */}
      <RequestsPopup
        friendRequests={pedidosAmizade.map((f) => ({
          userKey: f.userKey,
          displayName: f.displayName,
          avatar: f.avatar,
        }))}
        inviteRequests={convitesPendentes.map((c) => ({
          serverId: c.serverId,
          serverName: c.serverName,
          fromKey: c.fromKey,
          fromName: memberNames.get(c.fromKey) ?? '',
        }))}
        onRespondFriend={async (userKey, aceito) => {
          await window.concord.friends.respond(userKey, aceito);
          sounds.play(aceito ? 'success' : 'mute');
          await carregarPendencias();
        }}
        onRespondInvite={async (serverId, aceito) => {
          try {
            if (aceito) {
              const id = await window.concord.serverInvites.accept(serverId);
              sounds.play('success');
              await loadServers();
              setActiveServer(id);
            } else {
              await window.concord.serverInvites.decline(serverId);
            }
          } catch (e) {
            sounds.play('error');
            report(e);
          }
          await carregarPendencias();
        }}
      />

      {/* Flutuante so fora do palco: dentro dele as telas ja aparecem na grade. */}
      {aba !== 'call' && (
        <ScreenViewer remoteScreens={call.remoteScreens} memberNames={memberNames} />
      )}
      </div>
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
  ocupantes,
}: {
  label: string;
  items: ChannelView[];
  icon: React.ReactNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Quem esta dentro de cada canal de voz agora. */
  ocupantes?: (channelId: string) => {
    userKey: string;
    name: string;
    avatar: string | null;
    speaking: boolean;
  }[];
}) {
  return (
    <section>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</span>
        <button onClick={onAdd} className="text-ink-400 transition hover:text-violet-400">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {items.map((c) => {
        const dentro = ocupantes?.(c.id) ?? [];
        return (
          <div key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
                c.id === activeId
                  ? 'bg-violet-600/20 text-violet-200'
                  : 'text-ink-300 hover:bg-void-700 hover:text-ink-100'
              }`}
            >
              <span className="text-ink-400">{icon}</span>
              <span className="flex-1 truncate text-left">{c.name}</span>
              {dentro.length > 0 && (
                <span className="rounded bg-violet-600/25 px-1.5 text-[10px] font-semibold text-violet-200">
                  {dentro.length}
                </span>
              )}
            </button>

            {/* Quem esta na call agora, atualizado pela presenca dos peers. */}
            {dentro.map((pessoa) => (
              <div
                key={pessoa.userKey}
                className="ml-6 flex items-center gap-1.5 rounded px-2 py-1"
                title={pessoa.name}
              >
                <Avatar
                  name={pessoa.name}
                  userKey={pessoa.userKey}
                  src={pessoa.avatar}
                  size={20}
                />
                <span
                  className={`truncate text-xs ${
                    pessoa.speaking ? 'font-semibold text-status-online' : 'text-ink-300'
                  }`}
                >
                  {pessoa.name}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}


