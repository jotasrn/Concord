/**
 * Uma operacao e o unico tipo de dado que trafega entre peers. Ela e imutavel,
 * assinada pelo autor e nunca reescrita. O estado que a UI le (servidores,
 * canais, mensagens) e sempre uma projecao deterministica do conjunto de
 * operacoes conhecidas.
 *
 * Consequencia: qualquer peer que tenha o mesmo conjunto de operacoes chega
 * exatamente ao mesmo estado, independente da ordem em que elas chegaram.
 */
export type OpType =
  | 'server.create'
  | 'server.update'
  | 'user.profile'
  | 'member.join'
  | 'member.role'
  | 'channel.create'
  | 'channel.update'
  | 'channel.delete'
  | 'message.create'
  | 'message.edit'
  | 'message.delete';

export interface ServerCreatePayload {
  serverId: string;
  name: string;
  icon: string | null;
  /**
   * Nome de exibicao do criador. Precisa viajar na propria operacao: qualquer
   * estado que nao esteja no log nao replica para os outros peers e some
   * quando a projecao e reconstruida.
   */
  ownerDisplayName: string;
}

export interface ServerUpdatePayload {
  name?: string;
  icon?: string | null;
}

/**
 * Perfil do proprio usuario. E auto-declarado: so vale quando o autor da
 * operacao e o dono do perfil, e nesse caso sempre vence o nome que terceiros
 * atribuiram ao adiciona-lo a um servidor.
 *
 * O avatar viaja embutido como data URL. Num log replicado isso so e viavel
 * porque a imagem e reduzida a 128px antes de sair do cliente - um arquivo
 * grande ficaria replicado para sempre em todos os peers.
 */
export interface UserProfilePayload {
  displayName: string;
  /** data URL de imagem, ja redimensionada. Null remove o avatar. */
  avatar: string | null;
  bio: string | null;
}

export interface MemberJoinPayload {
  /** Chave publica de quem entrou (hex). */
  userKey: string;
  displayName: string;
  /** Codigo do convite usado, se houver. */
  inviteCode: string | null;
}

export interface MemberRolePayload {
  userKey: string;
  /** Bitmask de permissoes, serializado como string por ser BigInt. */
  permissions: string;
}

export interface ChannelCreatePayload {
  channelId: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  categoryId: string | null;
  position: number;
}

export interface ChannelUpdatePayload {
  channelId: string;
  name?: string;
  topic?: string | null;
  position?: number;
}

export interface ChannelDeletePayload {
  channelId: string;
}

export interface MessageCreatePayload {
  messageId: string;
  channelId: string;
  content: string;
  replyToId: string | null;
}

export interface MessageEditPayload {
  messageId: string;
  content: string;
}

export interface MessageDeletePayload {
  messageId: string;
}

export type OpPayload =
  | ServerCreatePayload
  | ServerUpdatePayload
  | UserProfilePayload
  | MemberJoinPayload
  | MemberRolePayload
  | ChannelCreatePayload
  | ChannelUpdatePayload
  | ChannelDeletePayload
  | MessageCreatePayload
  | MessageEditPayload
  | MessageDeletePayload;

/** Campos que entram na assinatura. `id` e `signature` ficam de fora. */
export interface SignedFields {
  type: OpType;
  /** Chave publica do autor, em hex. */
  authorKey: string;
  /** Servidor (comunidade) ao qual a operacao pertence. */
  serverId: string;
  /** Posicao no log do proprio autor. Comeca em 0 e nunca tem buraco. */
  seq: number;
  /**
   * Relogio de Lamport: garante que causalidade seja preservada mesmo com
   * relogios de parede dessincronizados entre as maquinas.
   */
  lamport: number;
  /** Relogio de parede do autor. Informativo apenas - peers podem mentir. */
  timestamp: number;
  payload: OpPayload;
}

export interface Operation extends SignedFields {
  /** sha256 dos bytes canonicos assinados, em hex. Enderecamento por conteudo. */
  id: string;
  /** Assinatura ed25519 sobre os bytes canonicos, em hex. */
  signature: string;
}
