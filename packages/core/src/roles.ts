import { Permission } from '@concord/types';

/**
 * Cargos como presets de permissao.
 *
 * Nao ha tabela de cargos: o que vale de verdade e o bitmask gravado em cada
 * membro, porque e ele que o reducer consulta ao aceitar uma operacao. O nome
 * do cargo e so rotulo para a interface - assim nao existe a possibilidade de
 * um cargo dizer uma coisa e as permissoes efetivas serem outra.
 */
export interface RolePreset {
  id: string;
  label: string;
  description: string;
  permissions: bigint;
}

const MEMBRO =
  BigInt(Permission.VIEW_CHANNEL) |
  BigInt(Permission.SEND_MESSAGES) |
  BigInt(Permission.CONNECT) |
  BigInt(Permission.SPEAK) |
  BigInt(Permission.STREAM);

const MODERADOR =
  MEMBRO |
  BigInt(Permission.MANAGE_CHANNELS) |
  BigInt(Permission.MANAGE_MEMBERS) |
  BigInt(Permission.KICK_MEMBERS);

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'membro',
    label: 'Membro',
    description: 'Conversa, entra em call e compartilha tela',
    permissions: MEMBRO,
  },
  {
    id: 'moderador',
    label: 'Moderador',
    description: 'Tudo de membro, mais silenciar, expulsar e gerenciar canais',
    permissions: MODERADOR,
  },
  {
    id: 'admin',
    label: 'Administrador',
    description: 'Controle total do servidor',
    permissions: BigInt(Permission.ADMINISTRATOR),
  },
];

/** Todas as permissoes individuais, para o ajuste fino. */
export const PERMISSION_LIST: { flag: Permission; label: string; hint: string }[] = [
  { flag: Permission.VIEW_CHANNEL, label: 'Ver canais', hint: 'Enxergar o servidor' },
  { flag: Permission.SEND_MESSAGES, label: 'Enviar mensagens', hint: 'Escrever no chat' },
  { flag: Permission.CONNECT, label: 'Entrar em call', hint: 'Conectar em canais de voz' },
  { flag: Permission.SPEAK, label: 'Falar', hint: 'Transmitir audio na call' },
  { flag: Permission.STREAM, label: 'Compartilhar tela', hint: 'Transmitir a tela' },
  { flag: Permission.MANAGE_CHANNELS, label: 'Gerenciar canais', hint: 'Criar, renomear, apagar' },
  {
    flag: Permission.MANAGE_MEMBERS,
    label: 'Gerenciar membros',
    hint: 'Apelido, cargo, silenciar',
  },
  { flag: Permission.KICK_MEMBERS, label: 'Expulsar', hint: 'Remover do servidor' },
  { flag: Permission.MANAGE_SERVER, label: 'Gerenciar servidor', hint: 'Nome e icone' },
  { flag: Permission.ADMINISTRATOR, label: 'Administrador', hint: 'Concede tudo acima' },
];

/** Nome do cargo que melhor descreve um bitmask, para exibir na lista. */
export function describeRole(permissions: string): string {
  const bits = BigInt(permissions);
  if (bits & BigInt(Permission.ADMINISTRATOR)) return 'Administrador';

  const preset = [...ROLE_PRESETS].reverse().find((p) => (bits & p.permissions) === p.permissions);
  return preset?.label ?? 'Personalizado';
}

export function hasPermission(permissions: string, flag: Permission): boolean {
  const bits = BigInt(permissions);
  if (bits & BigInt(Permission.ADMINISTRATOR)) return true;
  return (bits & BigInt(flag)) === BigInt(flag);
}
