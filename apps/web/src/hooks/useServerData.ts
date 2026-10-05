import { useCallback, useEffect, useState } from 'react';
import { sounds } from '../features/voice/audio/SoundEffects';
import type { ServerView, ChannelView, MemberView, MessageView } from '../types/concord-api';

export interface ServerDataState {
  servers: ServerView[];
  channels: ChannelView[];
  members: MemberView[];
  messages: MessageView[];
  activeServer: string | null;
  activeChannel: string | null;
  setActiveServer: (id: string | null) => void;
  setActiveChannel: (id: string | null) => void;
  loadServers: () => Promise<void>;
  loadServerContent: (serverId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
}

/**
 * Centraliza o carregamento de servidores, canais, membros e mensagens.
 *
 * Extraído de AppPage para manter o componente principal focado apenas em
 * renderização e interação - a lógica de dados fica aqui.
 */
export function useServerData(report: (e: unknown) => void): ServerDataState {
  const [servers, setServers] = useState<ServerView[]>([]);
  const [channels, setChannels] = useState<ChannelView[]>([]);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [activeServer, setActiveServer] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const list = await window.concord.servers.list();
      setServers(list);
      setActiveServer((current) => current ?? list[0]?.id ?? null);
    } catch (e) {
      report(e);
    }
  }, [report]);

  const loadServerContent = useCallback(
    async (serverId: string) => {
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
    },
    [report],
  );

  const loadMessages = useCallback(
    async (channelId: string) => {
      try {
        setMessages(await window.concord.messages.list(channelId, 100));
      } catch (e) {
        report(e);
      }
    },
    [report],
  );

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

  return {
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
  };
}
