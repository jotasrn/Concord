"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const core_1 = require("@concord/core");
/**
 * Estado vivo do processo principal: identidade desbloqueada, banco local e
 * no P2P. Fica isolado aqui para que os handlers de IPC nao virem um arquivo
 * gigante com regra de negocio dentro.
 */
class Session {
    dataDir;
    onOpsReceived;
    onVoiceSignal;
    onMigration;
    onPresence;
    onSocial;
    store = null;
    node = null;
    constructor(dataDir, onOpsReceived, onVoiceSignal = () => { }, onMigration = () => { }, onPresence = () => { }, onSocial = () => { }) {
        this.dataDir = dataDir;
        this.onOpsReceived = onOpsReceived;
        this.onVoiceSignal = onVoiceSignal;
        this.onMigration = onMigration;
        this.onPresence = onPresence;
        this.onSocial = onSocial;
        if (!(0, node_fs_1.existsSync)(dataDir))
            (0, node_fs_1.mkdirSync)(dataDir, { recursive: true });
    }
    get keystorePath() {
        return (0, node_path_1.join)(this.dataDir, 'keystore.json');
    }
    get dbPath() {
        return (0, node_path_1.join)(this.dataDir, 'concord.db');
    }
    hasAccount() {
        return (0, node_fs_1.existsSync)(this.keystorePath);
    }
    accountName() {
        if (!this.hasAccount())
            return null;
        const store = JSON.parse((0, node_fs_1.readFileSync)(this.keystorePath, 'utf8'));
        return store.displayName;
    }
    newRecoveryPhrase() {
        return (0, core_1.generateRecoveryPhrase)();
    }
    /** Cria a conta a partir de uma frase ja mostrada e confirmada pelo usuario. */
    createAccount(displayName, password, phrase) {
        if (this.hasAccount())
            throw new Error('Ja existe uma conta neste dispositivo');
        if (!(0, core_1.isValidRecoveryPhrase)(phrase))
            throw new Error('Frase de recuperacao invalida');
        if (password.length < 8)
            throw new Error('A senha precisa ter ao menos 8 caracteres');
        if (!displayName.trim())
            throw new Error('Escolha um nome de exibicao');
        const keystore = (0, core_1.encryptKeystore)(phrase, password, displayName.trim());
        (0, node_fs_1.writeFileSync)(this.keystorePath, JSON.stringify(keystore, null, 2), 'utf8');
    }
    /** Restaura em uma maquina nova usando so a frase. */
    restoreAccount(displayName, password, phrase) {
        if (!(0, core_1.isValidRecoveryPhrase)(phrase))
            throw new Error('Frase de recuperacao invalida');
        if (password.length < 8)
            throw new Error('A senha precisa ter ao menos 8 caracteres');
        if (!displayName.trim())
            throw new Error('Escolha um nome de exibicao');
        const keystore = (0, core_1.encryptKeystore)(phrase, password, displayName.trim());
        (0, node_fs_1.writeFileSync)(this.keystorePath, JSON.stringify(keystore, null, 2), 'utf8');
    }
    async unlock(password) {
        const keystore = JSON.parse((0, node_fs_1.readFileSync)(this.keystorePath, 'utf8'));
        const identity = (0, core_1.decryptKeystore)(keystore, password);
        this.store = new core_1.ConcordStore(this.dbPath, identity);
        // Servidores de versoes anteriores nao tem chave e nao sincronizam. O dono
        // consegue gerar uma; os demais precisam de um convite novo.
        const { migrados, semChave } = this.store.migrateServerKeys();
        if (migrados.length > 0 || semChave.length > 0) {
            this.onMigration({ migrados: migrados.length, semChave: semChave.map((s) => s.name) });
        }
        this.node = new core_1.P2PNode(this.store);
        this.node.on('ops:received', ({ serverId }) => this.onOpsReceived(serverId));
        this.node.on('voice:signal', ({ serverId, signal }) => this.onVoiceSignal(serverId, signal));
        this.node.on('presence:update', (snapshot) => this.onPresence(snapshot));
        // Pedido de amizade recebido: guarda como pendente e avisa a interface.
        this.node.on('friend:request', (r) => {
            const store = this.requireStore();
            const estado = store.social.upsertFriend(r.from, r.displayName, r.avatar, 'PENDING_IN');
            this.onSocial('friend:request', { ...r, state: estado });
        });
        this.node.on('friend:response', (r) => {
            const store = this.requireStore();
            if (r.accepted) {
                store.social.upsertFriend(r.from, r.displayName, null, 'ACCEPTED');
            }
            else {
                // Recusa apaga o pendente: manter aumentaria a confusao sem utilidade.
                store.social.removeFriend(r.from);
            }
            this.onSocial('friend:response', r);
        });
        this.node.on('invite:offer', (r) => {
            const store = this.requireStore();
            // Ja participa: nao ha o que aceitar.
            if (store.serverKey(r.serverId))
                return;
            store.social.addPendingInvite({
                serverId: r.serverId,
                serverName: r.serverName,
                fromKey: r.from,
                code: r.code,
            });
            this.onSocial('invite:offer', r);
        });
        await this.node.start();
        return identity;
    }
    isUnlocked() {
        return this.store !== null;
    }
    requireStore() {
        if (!this.store)
            throw new Error('Conta bloqueada');
        return this.store;
    }
    requireNode() {
        if (!this.node)
            throw new Error('Rede nao iniciada');
        return this.node;
    }
    /** Aplica a operacao local e ja empurra para os peers conectados. */
    async publish(serverId, action) {
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
    sendVoiceSignal(serverId, signal) {
        this.requireNode().sendVoiceSignal(serverId, signal);
    }
    createInvite(serverId) {
        return this.requireStore().createInvite(serverId);
    }
    async acceptInvite(code) {
        const serverId = this.requireStore().acceptInvite(code);
        await this.requireNode().joinServer(serverId);
        return serverId;
    }
    profile() {
        const store = this.requireStore();
        return {
            displayName: store.identity.displayName,
            publicKey: store.publicKeyHex,
            handle: (0, core_1.formatHandle)(store.identity.displayName, store.identity.publicKey),
        };
    }
    /** Servidores que ainda nao conseguem sincronizar por falta de chave. */
    serversWithoutKey() {
        return this.requireStore().serversWithoutKey().map((s) => s.name);
    }
    /** Publica o perfil e empurra para os peers de cada servidor afetado. */
    async updateProfile(profile) {
        const store = this.requireStore();
        const antes = new Map(store.listServers().map((s) => [s.id, new Set(store.operationsFor(s.id).map((o) => o.id))]));
        store.updateProfile(profile);
        const node = this.node;
        if (!node)
            return;
        for (const server of store.listServers()) {
            const conhecidas = antes.get(server.id) ?? new Set();
            const novas = store.operationsFor(server.id).filter((o) => !conhecidas.has(o.id));
            node.broadcast(server.id, novas);
        }
    }
    profileOf(userKey) {
        return this.requireStore().profileOf(userKey);
    }
    setStatus(status) {
        this.requireNode().setStatus(status);
    }
    /** Anuncia em qual canal de voz estamos, para a lista em tempo real. */
    setVoiceChannel(channelId) {
        this.node?.setVoiceChannel(channelId);
    }
    presence() {
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
    async sendFriendRequest(targetKey) {
        const store = this.requireStore();
        if (!/^[0-9a-f]{64}$/.test(targetKey))
            throw new Error('Chave publica invalida');
        if (targetKey === store.publicKeyHex)
            throw new Error('Essa e a sua propria chave');
        const perfil = store.profileOf(store.publicKeyHex);
        store.social.upsertFriend(targetKey, '', null, 'PENDING_OUT');
        return this.requireNode().sendToUser(targetKey, {
            t: 'friend:request',
            displayName: perfil?.displayName ?? store.identity.displayName,
            avatar: perfil?.avatar ?? null,
        });
    }
    async respondFriendRequest(targetKey, accepted) {
        const store = this.requireStore();
        if (accepted)
            store.social.upsertFriend(targetKey, store.social.getFriend(targetKey)?.displayName ?? '', null, 'ACCEPTED');
        else
            store.social.removeFriend(targetKey);
        const perfil = store.profileOf(store.publicKeyHex);
        await this.requireNode().sendToUser(targetKey, {
            t: 'friend:response',
            accepted,
            displayName: perfil?.displayName ?? store.identity.displayName,
        });
    }
    removeFriend(targetKey) {
        this.requireStore().social.removeFriend(targetKey);
    }
    /** Manda um convite de servidor direto para a caixa de entrada do amigo. */
    async sendServerInvite(serverId, targetKey) {
        const store = this.requireStore();
        const servidor = store.listServers().find((s) => s.id === serverId);
        if (!servidor)
            throw new Error('Servidor desconhecido');
        return this.requireNode().sendToUser(targetKey, {
            t: 'invite:offer',
            serverId,
            serverName: servidor.name,
            code: store.createInvite(serverId),
        });
    }
    async acceptServerInvite(serverId) {
        const store = this.requireStore();
        const convite = store.social.listPendingInvites().find((i) => i.serverId === serverId);
        if (!convite)
            throw new Error('Convite nao encontrado');
        const id = store.acceptInvite(convite.code);
        store.social.removePendingInvite(serverId);
        await this.requireNode().joinServer(id);
        return id;
    }
    declineServerInvite(serverId) {
        this.requireStore().social.removePendingInvite(serverId);
    }
    storageUsage() {
        return this.requireStore().storageUsage();
    }
    pruneHistory(olderThanDays) {
        return this.requireStore().pruneHistory(olderThanDays);
    }
    peerCount() {
        return this.node?.peerCount() ?? 0;
    }
    async shutdown() {
        await this.node?.destroy();
        this.store?.close();
        this.node = null;
        this.store = null;
    }
}
exports.Session = Session;
