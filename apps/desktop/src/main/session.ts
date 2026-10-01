import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ConcordStore,
  EncryptedKeystore,
  Identity,
  P2PNode,
  decryptKeystore,
  encryptKeystore,
  formatHandle,
  generateRecoveryPhrase,
  identityFromPhrase,
  isValidRecoveryPhrase,
  toHex,
} from '@concord/core';

/**
 * Estado vivo do processo principal: identidade desbloqueada, banco local e
 * no P2P. Fica isolado aqui para que os handlers de IPC nao virem um arquivo
 * gigante com regra de negocio dentro.
 */
export class Session {
  private store: ConcordStore | null = null;
  private node: P2PNode | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly onOpsReceived: (serverId: string) => void,
    private readonly onVoiceSignal: (serverId: string, signal: unknown) => void = () => {},
    private readonly onMigration: (info: { migrados: number; semChave: string[] }) => void = () => {},
    private readonly onPresence: (
      snapshot: Record<string, { status: string; voice: string | null }>,
    ) => void = () => {},
    private readonly onSocial: (evento: string, dados: unknown) => void = () => {},
    /** Sinalizacao WebRTC de uma chamada direta (sem servidor envolvido). */
    private readonly onCallSignal: (callId: string, signal: unknown) => void = () => {},
  ) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  private get keystorePath(): string {
    return join(this.dataDir, 'keystore.json');
  }

  private get dbPath(): string {
    return join(this.dataDir, 'concord.db');
  }

  hasAccount(): boolean {
    return existsSync(this.keystorePath);
  }

  accountName(): string | null {
    if (!this.hasAccount()) return null;
    const store = JSON.parse(readFileSync(this.keystorePath, 'utf8')) as EncryptedKeystore;
    return store.displayName;
  }

  newRecoveryPhrase(): string {
    return generateRecoveryPhrase();
  }

  /** Cria a conta a partir de uma frase ja mostrada e confirmada pelo usuario. */
  createAccount(displayName: string, password: string, phrase: string): void {
    if (this.hasAccount()) throw new Error('Ja existe uma conta neste dispositivo');
    if (!isValidRecoveryPhrase(phrase)) throw new Error('Frase de recuperacao invalida');
    if (password.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres');
    if (!displayName.trim()) throw new Error('Escolha um nome de exibicao');

    const keystore = encryptKeystore(phrase, password, displayName.trim());
    writeFileSync(this.keystorePath, JSON.stringify(keystore, null, 2), 'utf8');
  }

  /**
   * Restaura em uma maquina nova (ou recupera a senha esquecida) usando so a
   * frase.
   *
   * Quando ja existe uma conta neste dispositivo, so prossegue sem pedir
   * confirmacao se a frase pertencer a MESMA identidade (chave publica
   * identica) - exatamente o caso de "esqueci a senha". A chave do Vault
   * deriva so da semente da frase, nunca da senha, entao restaurar a mesma
   * frase com senha nova e sempre seguro: o banco local continua legivel.
   *
   * Uma frase de identidade DIFERENTE sobrescreveria o keystore e tornaria o
   * banco atual ilegivel para sempre - sem aviso nenhum antes desta checagem.
   * Para esse caso, quem chama precisa passar `confirmOverwrite: true`
   * explicitamente.
   */
  restoreAccount(
    displayName: string,
    password: string,
    phrase: string,
    confirmOverwrite = false,
  ): void {
    if (!isValidRecoveryPhrase(phrase)) throw new Error('Frase de recuperacao invalida');
    if (password.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres');
    if (!displayName.trim()) throw new Error('Escolha um nome de exibicao');

    if (this.hasAccount()) {
      const atual = JSON.parse(readFileSync(this.keystorePath, 'utf8')) as EncryptedKeystore;
      const novaIdentidade = identityFromPhrase(phrase, displayName.trim());
      const mesmaConta = toHex(novaIdentidade.publicKey) === atual.publicKey;
      if (!mesmaConta && !confirmOverwrite) {
        throw new Error('CONTA_DIFERENTE');
      }
    }

    const keystore = encryptKeystore(phrase, password, displayName.trim());
    writeFileSync(this.keystorePath, JSON.stringify(keystore, null, 2), 'utf8');
  }

  async unlock(password: string): Promise<Identity> {
    const keystore = JSON.parse(readFileSync(this.keystorePath, 'utf8')) as EncryptedKeystore;
    const identity = decryptKeystore(keystore, password);

    this.store = new ConcordStore(this.dbPath, identity);

    // Servidores de versoes anteriores nao tem chave e nao sincronizam. O dono
    // consegue gerar uma; os demais precisam de um convite novo.
    const { migrados, semChave } = this.store.migrateServerKeys();
    if (migrados.length > 0 || semChave.length > 0) {
      this.onMigration({ migrados: migrados.length, semChave: semChave.map((s) => s.name) });
    }

    this.node = new P2PNode(this.store);
    this.node.on('ops:received', ({ serverId }) => this.onOpsReceived(serverId));
    this.node.on('voice:signal', ({ serverId, signal }) => this.onVoiceSignal(serverId, signal));
    this.node.on('presence:update', (snapshot) => this.onPresence(snapshot));

    // Pedido de amizade recebido: guarda como pendente e avisa a interface.
    this.node.on('friend:request', (r: { from: string; displayName: string; avatar: string | null }) => {
      const store = this.requireStore();
      const estado = store.social.upsertFriend(r.from, r.displayName, r.avatar, 'PENDING_IN');
      this.onSocial('friend:request', { ...r, state: estado });
    });

    this.node.on('friend:response', (r: { from: string; accepted: boolean; displayName: string }) => {
      const store = this.requireStore();
      if (r.accepted) {
        store.social.upsertFriend(r.from, r.displayName, null, 'ACCEPTED');
      } else {
        // Recusa apaga o pendente: manter aumentaria a confusao sem utilidade.
        store.social.removeFriend(r.from);
      }
      this.onSocial('friend:response', r);
    });

    this.node.on('invite:offer', (r: { from: string; serverId: string; serverName: string; code: string }) => {
      const store = this.requireStore();
      // Ja participa: nao ha o que aceitar.
      if (store.serverKey(r.serverId)) return;
      store.social.addPendingInvite({
        serverId: r.serverId,
        serverName: r.serverName,
        fromKey: r.from,
        code: r.code,
      });
      this.onSocial('invite:offer', r);
    });

    // Chamada direta: os quatro eventos de controle vao para o mesmo canal
    // social que ja alimenta os popups de amizade e convite - a interface so
    // precisa ouvir um lugar so. A sinalizacao WebRTC (muito mais frequente)
    // tem um canal proprio, no mesmo padrao do voice:signal de servidor.
    this.node.on('call:invite', (r: { from: string; callId: string; displayName: string; avatar: string | null }) =>
      this.onSocial('call:invite', r),
    );
    this.node.on('call:accept', (r: { from: string; callId: string }) =>
      this.onSocial('call:accept', r),
    );
    this.node.on('call:decline', (r: { from: string; callId: string }) =>
      this.onSocial('call:decline', r),
    );
    this.node.on('call:end', (r: { from: string; callId: string }) =>
      this.onSocial('call:end', r),
    );
    this.node.on('call:signal', ({ callId, signal }: { callId: string; signal: unknown }) =>
      this.onCallSignal(callId, signal),
    );

    await this.node.start();

    return identity;
  }

  isUnlocked(): boolean {
    return this.store !== null;
  }

  requireStore(): ConcordStore {
    if (!this.store) throw new Error('Conta bloqueada');
    return this.store;
  }

  requireNode(): P2PNode {
    if (!this.node) throw new Error('Rede nao iniciada');
    return this.node;
  }

  /** Aplica a operacao local e ja empurra para os peers conectados. */
  async publish<T>(serverId: string, action: () => T): Promise<T> {
    const store = this.requireStore();
    const antes = new Set(store.operationsFor(serverId).map((o) => o.id));
    const result = action();
    const novas = store.operationsFor(serverId).filter((o) => !antes.has(o.id));

    if (this.node) {
      await this.node.joinServer(serverId);
      this.node.broadcast(serverId, novas);
    }
    return result;
  }

  sendVoiceSignal(serverId: string, signal: any): void {
    this.requireNode().sendVoiceSignal(serverId, signal);
  }

  createInvite(serverId: string): string {
    return this.requireStore().createInvite(serverId);
  }

  async acceptInvite(code: string): Promise<string> {
    const serverId = this.requireStore().acceptInvite(code);
    await this.requireNode().joinServer(serverId);
    return serverId;
  }

  profile(): { displayName: string; publicKey: string; handle: string } {
    const store = this.requireStore();
    return {
      displayName: store.identity.displayName,
      publicKey: store.publicKeyHex,
      handle: formatHandle(store.identity.displayName, store.identity.publicKey),
    };
  }

  /** Servidores que ainda nao conseguem sincronizar por falta de chave. */
  serversWithoutKey(): string[] {
    return this.requireStore().serversWithoutKey().map((s) => s.name);
  }

  /** Publica o perfil e empurra para os peers de cada servidor afetado. */
  async updateProfile(profile: {
    displayName: string;
    avatar: string | null;
    bio: string | null;
  }): Promise<void> {
    const store = this.requireStore();
    const antes = new Map(
      store.listServers().map((s) => [s.id, new Set(store.operationsFor(s.id).map((o) => o.id))]),
    );

    store.updateProfile(profile);

    const node = this.node;
    if (!node) return;
    for (const server of store.listServers()) {
      const conhecidas = antes.get(server.id) ?? new Set<string>();
      const novas = store.operationsFor(server.id).filter((o) => !conhecidas.has(o.id));
      node.broadcast(server.id, novas);
    }
  }

  profileOf(userKey: string) {
    return this.requireStore().profileOf(userKey);
  }

  setStatus(status: 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE'): void {
    this.requireNode().setStatus(status);
  }

  /** Anuncia em qual canal de voz estamos, para a lista em tempo real. */
  setVoiceChannel(channelId: string | null): void {
    this.node?.setVoiceChannel(channelId);
  }

  presence(): { status: string; peers: Record<string, { status: string; voice: string | null }> } {
    const node = this.node;
    return {
      status: node?.getStatus() ?? 'OFFLINE',
      peers: node?.presenceSnapshot() ?? {},
    };
  }

  // ---------- amigos e convites ----------

  listFriends() {
    return this.requireStore().social.listFriends();
  }

  listPendingInvites() {
    return this.requireStore().social.listPendingInvites();
  }

  /** Envia pedido de amizade para uma chave publica. */
  async sendFriendRequest(targetKey: string): Promise<'entregue' | 'na-fila'> {
    const store = this.requireStore();
    if (!/^[0-9a-f]{64}$/.test(targetKey)) throw new Error('Chave publica invalida');
    if (targetKey === store.publicKeyHex) throw new Error('Essa e a sua propria chave');

    const perfil = store.profileOf(store.publicKeyHex);
    store.social.upsertFriend(targetKey, '', null, 'PENDING_OUT');

    return this.requireNode().sendToUser(targetKey, {
      t: 'friend:request',
      displayName: perfil?.displayName ?? store.identity.displayName,
      avatar: perfil?.avatar ?? null,
    });
  }

  async respondFriendRequest(targetKey: string, accepted: boolean): Promise<void> {
    const store = this.requireStore();
    if (accepted) store.social.upsertFriend(targetKey, store.social.getFriend(targetKey)?.displayName ?? '', null, 'ACCEPTED');
    else store.social.removeFriend(targetKey);

    const perfil = store.profileOf(store.publicKeyHex);
    await this.requireNode().sendToUser(targetKey, {
      t: 'friend:response',
      accepted,
      displayName: perfil?.displayName ?? store.identity.displayName,
    });
  }

  removeFriend(targetKey: string): void {
    this.requireStore().social.removeFriend(targetKey);
  }

  /** Manda um convite de servidor direto para a caixa de entrada do amigo. */
  async sendServerInvite(serverId: string, targetKey: string): Promise<'entregue' | 'na-fila'> {
    const store = this.requireStore();
    const servidor = store.listServers().find((s) => s.id === serverId);
    if (!servidor) throw new Error('Servidor desconhecido');

    return this.requireNode().sendToUser(targetKey, {
      t: 'invite:offer',
      serverId,
      serverName: servidor.name,
      code: store.createInvite(serverId),
    });
  }

  async acceptServerInvite(serverId: string): Promise<string> {
    const store = this.requireStore();
    const convite = store.social.listPendingInvites().find((i) => i.serverId === serverId);
    if (!convite) throw new Error('Convite nao encontrado');

    const id = store.acceptInvite(convite.code);
    store.social.removePendingInvite(serverId);
    await this.requireNode().joinServer(id);
    return id;
  }

  declineServerInvite(serverId: string): void {
    this.requireStore().social.removePendingInvite(serverId);
  }

  // ---------- chamada direta ----------

  async callInvite(
    targetKey: string,
    callId: string,
  ): Promise<'entregue' | 'na-fila'> {
    const store = this.requireStore();
    const perfil = store.profileOf(store.publicKeyHex);
    return this.requireNode().callInvite(
      targetKey,
      callId,
      perfil?.displayName ?? store.identity.displayName,
      perfil?.avatar ?? null,
    );
  }

  async callRespond(targetKey: string, callId: string, accepted: boolean): Promise<void> {
    await this.requireNode().callRespond(targetKey, callId, accepted);
  }

  async callEnd(targetKey: string, callId: string): Promise<void> {
    await this.requireNode().callEnd(targetKey, callId);
  }

  sendCallSignal(targetKey: string, signal: any): void {
    this.requireNode().callSignal(targetKey, signal);
  }

  storageUsage() {
    return this.requireStore().storageUsage();
  }

  pruneHistory(olderThanDays: number) {
    return this.requireStore().pruneHistory(olderThanDays);
  }

  peerCount(): number {
    return this.node?.peerCount() ?? 0;
  }

  async shutdown(): Promise<void> {
    await this.node?.destroy();
    this.store?.close();
    this.node = null;
    this.store = null;
  }
}
