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

- O SQLite local e cifrado por um **Vault** (`crypto/vault.ts`) cuja chave
  deriva da semente da identidade e so existe em memoria apos o desbloqueio.
  Sem senha, o banco e ruido.
- Testes (`vault.test.ts`, `keystore.test.ts`) verificam que o arquivo em
  disco nao contem nenhuma palavra da frase de recuperacao nem texto de
  mensagem legivel.

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

## O que isso nao cobre

- Nao ha TURN: NAT simetrico dos dois lados ao mesmo tempo pode falhar em
  conectar. Sem impacto de seguranca, so de conectividade.
- Nao ha assinatura de codigo (code signing) do instalador: o Windows
  SmartScreen avisa na primeira instalacao. Isso nao afeta a integridade do
  binario ja instalado (fuses cobrem isso), so a experiencia de baixar.
