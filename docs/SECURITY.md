# Seguranca

Modelo de ameaca de um app P2P sem servidor: nao ha autoridade central para
confiar, entao cada peer verifica tudo por conta propria. Isso troca "confie
no servidor" por "verifique a assinatura", com um efeito colateral direto -
**um cliente modificado pode ignorar qualquer regra que so exista na
interface.** Toda regra que importa de verdade esta no reducer (aplicada por
quem recebe a operacao), nunca so no React.

## Identidade

- Par de chaves **Ed25519**, gerado pelo `node:crypto` nativo (`packages/core/src/identity/keypair.ts`).
  Nao ha dependencia ESM externa aqui de proposito - `@noble/ed25519` quebrava
  o processo principal do Electron, que e CJS.
- A conta e recuperada por uma **frase de 12 palavras (BIP39)**. Não ha
  e-mail, nao ha "esqueci minha senha": a frase E a conta. Quem a perde,
  perde o acesso para sempre - nao existe reset porque nao existe quem
  resetar.
- O keystore em disco e cifrado com **scrypt (N=65536) + AES-256-GCM**
  (`identity/keystore.ts`). Senha errada falha na autenticacao do GCM, nunca
  devolve dado corrompido silenciosamente.

## Em transito

- Hyperswarm cifra a conexao entre dois peers (protocolo Noise) antes de
  qualquer mensagem da aplicacao trafegar.
- Identidade da conexao **nao e a identidade Concord**. Um peer poderia
  simplesmente declarar a chave publica de outra pessoa; por isso, logo apos
  conectar, cada lado assina um desafio aleatorio (`auth:challenge` /
  `auth:proof` em `p2p/node.ts`) e so depois disso a chave declarada e aceita
  como verdadeira.
- Operacoes de um servidor, presenca e sinalizacao de voz sao cifradas de
  novo, com **AES-256-GCM sob a chave daquele servidor** (`crypto/serverKey.ts`).
  Isso garante que so quem tem o convite (logo, a chave) consegue ler - nao
  basta descobrir o topico da DHT.
- Video, audio e compartilhamento de tela usam **DTLS-SRTP**, obrigatorio em
  qualquer implementacao de WebRTC.
- Chamada direta (sem servidor em comum) nao tem chave propria: a conexao ja
  esta cifrada pelo Hyperswarm e a identidade ja foi provada antes de
  qualquer mensagem de chamada ser aceita, entao nao ha o que uma segunda
  camada de cifragem acrescentaria.

## Em repouso

**Nem tudo no banco local e cifrado - so o que o Vault explicitamente sela.**
Hoje isso e o conteudo de mensagem (`message.content`) e o codigo de convite
pendente (que carrega a chave do servidor). O resto da projecao - nome de
servidor e de canal, lista de membros, amigos, apelido, avatar, biografia, e
os metadados de toda operacao do log (quem escreveu, em qual servidor, quando)
- fica em **texto claro** no `concord.db`. Quem tiver acesso ao arquivo (um
backup, outro usuario da mesma maquina, um antivirus que indexa o conteudo)
le isso sem precisar de senha nenhuma.

Isso e uma lacuna real, nao uma decisao deliberada - cifrar todos esses campos
exigiria reescrever boa parte das queries da projecao (cada SELECT que hoje
le a coluna direto passaria a abrir/fechar o Vault) e ainda deixaria o
*volume* de mensagens e a *estrutura* dos servidores visiveis mesmo cifrando
o conteudo. Fica registrado aqui para nao haver duvida sobre o que o Vault
protege de fato.

Testes (`vault.test.ts`, `keystore.test.ts`) verificam que o arquivo em disco
nao contem nenhuma palavra da frase de recuperacao nem o texto de uma
mensagem - so isso, nada alem disso.

## Validacao de entrada

Toda operacao que chega da rede passa por `ops/validate.ts` antes de tocar o
banco: tipo, tamanho (`LIMITS.CONTENT`, `LIMITS.NAME`, `LIMITS.AVATAR` etc.) e
formato do payload. Sem isso, um peer hostil poderia mandar um payload nulo,
um tipo trocado ou uma mensagem de alguns megabytes.

Cada operacao e aplicada dentro do proprio try/catch no reducer
(`ops/reducer.ts`): uma operacao malformada e descartada sem abortar a
transacao inteira, o que impediria as operacoes validas na mesma leva de
serem aplicadas.

Testes adversariais dedicados em `ops/hostile.test.ts` cobrem exatamente esses
casos.

## Moderacao e a regra do "so o receptor decide"

Nao existe servidor para expulsar alguem de verdade - o maximo que da para
fazer e parar de aceitar as operacoes dele. Por isso:

- **Silenciar em chamada** e aplicado por quem *ouve*: o audio do
  silenciado nao e reproduzido no elemento local. Um cliente modificado do
  silenciado continuaria transmitindo, mas ninguem honesto tocaria o som.
- **Expulsar** para novas mensagens do expulso serem aceitas (o reducer para
  de aplicar operacoes dele naquele servidor), mas o historico que ele ja
  tinha baixado antes continua no computador dele. Nao ha como apagar
  remotamente algo que ja replicou.
- **Cargos e permissoes** sao bitmasks verificados no reducer a cada
  operacao (`roles.ts`). A interface esconde botoes de quem nao tem
  permissao, mas isso e conveniencia - a aplicacao real acontece no reducer,
  em toda maquina que recebe a operacao.

## Seguranca do executavel

- `contextIsolation: true`, `nodeIntegration: false`: o renderer nunca tem
  `require`. Toda operacao privilegiada passa pelo IPC, que valida a entrada.
- DevTools bloqueado em producao (atalhos interceptados, `devtools-opened`
  fecha na hora). Nao impede alguem de extrair o `asar` manualmente, mas tira
  o caminho de um clique.
- Sem sourcemap no build de producao - o mapa carrega o TypeScript original
  inteiro, comentarios inclusive; empacotar isso equivaleria a distribuir o
  codigo-fonte.
- Fuses do Electron gravados apos empacotar (`scripts/afterPack.js`):
  `RunAsNode` desligado, validacao de integridade do asar ligada.
- Navegacao para fora do app e bloqueada (`will-navigate`); links em
  mensagens abrem no navegador do sistema, nunca dentro da janela do
  Concord.

## Revisao externa (commit 72edf04) - o que foi corrigido

Uma avaliacao externa encontrou cinco falhas criticas na logica de
autorizacao, confirmadas por prova de conceito. Corrigidas nesta rodada:

| Falha | Correcao |
| --- | --- |
| Qualquer membro com a chave do servidor virava dono (server.create com `lamport` negativo vencia a corrida de replay) | `serverId` agora e autocertificado - `sha256(autor + nonce)`. Um impostor nunca produz o mesmo id de um servidor que nao criou, nao importa o lamport que escolha |
| Moderador se autopromovia a administrador, ou agia sobre um administrador/outro moderador | `member.role`, `member.kick` e `member.mute` agora exigem que o alvo nao tenha nenhuma permissao que quem age tambem nao tenha, e que a permissao concedida esteja dentro da de quem concede |
| Administrador do proprio servidor apagava mensagem de outro servidor | `message.edit`/`message.delete` conferem o `server_id` real da mensagem contra `op.serverId` |
| Canal de um servidor "sequestrava" o id de um canal de outro | `channelId` tambem e autocertificado - `sha256(serverId + nonce)` |
| Operacao com `op.serverId` diferente do envelope cifrado que a trouxe era aceita | `node.ts` descarta qualquer operacao cujo `serverId` nao bate com o envelope, antes de chegar no reducer |
| Reflexao na prova de identidade (um peer no meio repassava o desafio de uma vitima para um terceiro e o fazia assinar por ele) | so o PRIMEIRO `auth:challenge` de cada conexao e respondido; qualquer challenge extra e ignorado |

Tambem corrigido, fora da lista de cinco: `have`/`want`/`ops` agora exigem
identidade ja provada (antes um peer conectado-mas-nao-verificado conseguia
disparar sincronizacao completa); no maximo uma conexao viva por identidade
(a mais antiga e encerrada ao verificar uma nova); lote de sincronizacao
limitado a 200 operacoes por frame, e o teto de frame caiu de 8MB para 2MB.

E os tres itens sociais apontados como "Medios" numa revisao seguinte:
- `friend:response{accepted:true}` so vira amizade se havia um pedido nosso
  em aberto (`PENDING_OUT`) - antes qualquer estranho virava "amigo aceito"
  do nada, e amizade e o que da acesso a convite de servidor e chamada direta.
- `pending_invites` tinha chave unica so em `server_id`; qualquer peer que
  soubesse o id de um convite ja pendente sobrescrevia o codigo (e o
  remetente) do convite legitimo de um amigo. A chave virou composta
  (`server_id`, `from_key`) - cada remetente tem sua propria linha.
- `call:invite` tocava o telefone para qualquer chave publica, com o nome
  que o remetente quisesse declarar. Agora so chega na interface quando o
  remetente ja e amigo aceito; de resto, recusa em silencio.

Os cinco ataques (e as variantes de cada um) viraram testes de regressao em
[`ops/attacks.test.ts`](../packages/core/src/ops/attacks.test.ts) - rodam em
todo `npm test`.

### O que permanece em aberto

- **Reescrever o passado continua possivel.** Uma mensagem com `lamport`
  menor que o de um kick/mute e processada, no replay, ANTES da punicao -
  indistinguivel de uma mensagem legitima atrasada pela rede (o proprio
  projeto depende de aceitar isso para peers que voltam de offline
  funcionarem). A correcao de verdade exige causalidade real no log - cada
  operacao referenciando o hash das que seu autor conhecia ao cria-la, um DAG
  em vez de um lamport livre - que e uma mudanca de formato de operacao,
  nao um ajuste pontual.
- **Expulsar nao revoga a chave do servidor.** Quem foi expulso continua
  conseguindo decifrar qualquer coisa selada com aquela chave, inclusive
  mensagens futuras, porque a chave nunca roda. Rotacionar ao expulsar
  exigiria reenviar a chave nova a cada membro restante (sender keys ou algo
  como MLS), uma mudanca de protocolo maior que o escopo desta rodada.
- **A ponte web (`apps/server`) nao tem autenticacao nem limite por conexao.**
  Cada WebSocket que conecta cria um no Hyperswarm e um diretorio proprios,
  sem checagem nenhuma. Nao deveria rodar em producao exposta sem isso -
  veja [DEPLOY_WEB.md](DEPLOY_WEB.md).
- **Electron 32 esta fora do ciclo de suporte.** Atualizar exige testar a
  build inteira (modulos nativos, empacotamento) numa maquina real antes de
  distribuir - nao e algo para trocar as pressas.

## O que isso nao cobre

- Nao ha TURN: NAT simetrico dos dois lados ao mesmo tempo pode falhar em
  conectar. Sem impacto de seguranca, so de conectividade.
- Nao ha assinatura de codigo (code signing) do instalador: o Windows
  SmartScreen avisa na primeira instalacao. Isso nao afeta a integridade do
  binario ja instalado (fuses cobrem isso), so a experiencia de baixar.
