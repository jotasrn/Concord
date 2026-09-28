# Concord

Comunicacao por voz, video e texto para gamers - **sem servidor**. Cada pessoa
instala o app, cria a conta na propria maquina e os dados replicam direto
entre os dispositivos de todo mundo (P2P via [Hyperswarm](https://github.com/holepunchto/hyperswarm)).
Quem esteve offline puxa dos peers o que perdeu ao voltar.

Nao ha Docker, nao ha banco de dados central, nao ha conta perdida por causa
de um servidor fora do ar - porque nao existe servidor. A troca e explicita:
sem autoridade central para recuperar senha, arbitrar apelido duplicado ou
apagar o historico de quem foi expulso. Detalhes da decisao em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## O que ja funciona

- **Servidores e canais** - texto e voz, com convite cifrado ponta a ponta
- **Chat** - links clicaveis, edicao e apagar mensagem propria
- **Voz** - AEC/NS/AGC, deteccao de fala por limiar relativo ao ruido, perfil
  de latencia ultra-baixa (Opus a 10ms, jitter buffer zerado)
- **Video e compartilhamento de tela** - codec AV1/VP9 quando disponivel,
  pausa sem derrubar a chamada, picture-in-picture, tela cheia
- **Chamada direta** - liga para um amigo especifico, sem precisar de um
  servidor em comum
- **Bolhas flutuantes** - overlay transparente sobre jogos mostrando quem
  esta falando
- **Moderacao** - cargos, silenciar e expulsar; aplicado do lado de quem
  recebe, ja que nao ha autoridade central para impor nada
- **Perfil** - foto, biografia, status (online/ausente/nao perturbe/invisivel),
  apelido por servidor
- **Configuracoes de recurso** - teto de memoria, nucleos de CPU, limite de
  armazenamento
- **Atualizacao automatica** - via GitHub Releases, nunca reinicia com
  chamada em andamento (veja [docs/ATUALIZACAO.md](docs/ATUALIZACAO.md))
- **Seguranca do executavel** - DevTools bloqueado em producao, sem
  sourcemap, fuses do Electron (sem `RUN_AS_NODE`, integridade do asar)

Pendente: transmissao de webcam durante a chamada (a captura ja existe nas
configuracoes; falta ligar ao transporte).

## Como funciona, em uma frase

Toda mudanca que precisa sobreviver (mensagem, canal, membro, perfil) e uma
**operacao assinada** que entra num log local; peers trocam o que um ainda
nao tem. Estado que nao e operacao - status, quem esta em chamada, sinalizacao
WebRTC - vive so na conexao e nunca precisa sobreviver a nada.

```
apps/desktop/   Electron - processo principal (Node) + janela do overlay
apps/web/       Interface (React) - roda dentro do Electron OU no navegador
apps/server/    Ponte WebSocket opcional p/ acessar pelo navegador (ver abaixo)
packages/core/  O nucleo: identidade, log assinado, SQLite, rede P2P
packages/types/ Contratos TypeScript compartilhados
docs/           Arquitetura, seguranca, atualizacao, deploy web
```

Descricao arquivo por arquivo em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rodar em desenvolvimento

Requisito: **Node 20+** (o CI usa Node 22).

```bash
npm install
```

```bash
npm run dev
```

Isso builda tudo e abre a janela do Electron com hot reload no processo
principal. Uma conta e criada localmente na primeira execucao - so uma frase
de recuperacao de 12 palavras, sem e-mail nem senha em servidor nenhum.

Para testar P2P de verdade, repita a instalacao numa segunda maquina (ou numa
segunda pasta de dados na mesma maquina) e gere um convite de servidor de um
lado para o outro.

## Gerar o instalador

```bash
npm run dist
```

Sai em `%LOCALAPPDATA%\Concord-build\release` (fora do repositorio de
proposito - OneDrive trava o `asar` no meio do empacotamento). Produz um
instalador NSIS e uma versao `.zip` sem instalacao.

Publicar uma versao nova (dispara build + release automatico via GitHub
Actions): veja [docs/ATUALIZACAO.md](docs/ATUALIZACAO.md).

## Cliente web (opcional)

A interface tambem roda no navegador, falando com o nucleo P2P atraves de uma
ponte WebSocket (`apps/server`) em vez de IPC do Electron - util para acessar
de um dispositivo onde nao da para instalar o app. Captura de tela e o
overlay de bolhas nao existem nesse modo (dependem de APIs do Electron).
Deploy em [docs/DEPLOY_WEB.md](docs/DEPLOY_WEB.md).

## Scripts

| Comando | Efeito |
| --- | --- |
| `npm run dev` | Builda tudo e abre o Electron com hot reload |
| `npm run build` | Compila todos os workspaces, na ordem de dependencia |
| `npm test` | Roda os testes de todos os workspaces |
| `npm run dist` | Gera o instalador local, sem publicar |
| `npm run dist --workspace=apps/desktop` | Idem, direto no workspace |

## Testes

```bash
npm test
```

75 testes no `packages/core`: convergencia entre peers, assinatura e
verificacao de operacoes, sincronizacao apos ficar offline, protocolo de
enquadramento e um conjunto adversarial (payload nulo, tipo errado, mensagem
gigante, uma operacao invalida que nao pode derrubar as demais).

## Documentacao

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - os tres processos, o log
  assinado, arquivo por arquivo do que existe
- [SECURITY.md](docs/SECURITY.md) - identidade, cifragem, moderacao,
  seguranca do executavel
- [ATUALIZACAO.md](docs/ATUALIZACAO.md) - como o auto-update funciona e como
  publicar uma versao
- [DEPLOY_WEB.md](docs/DEPLOY_WEB.md) - rodar a ponte WebSocket para acesso
  pelo navegador
- [WEBRTC.md](docs/WEBRTC.md) - sinalizacao, perfis de latencia, codecs

## Limitacoes conhecidas

Consequencia direta de nao haver servidor:

- **Sem recuperacao de senha.** A frase de 12 palavras E a conta. Perdeu as
  duas, perdeu o acesso.
- **Sem nomes de usuario unicos.** Duas pessoas podem escolher o mesmo nome;
  quem te conhece te identifica pela chave publica, nao pelo nome.
- **Moderacao nao e absoluta.** Expulsar impede novas mensagens da pessoa, mas
  o historico que ela ja baixou continua no computador dela - nao ha como
  apagar remotamente.
- **Sem TURN.** Funciona atras da maioria dos NATs por STUN publico; NAT
  simetrico dos dois lados ao mesmo tempo pode falhar em conectar.
- **Sem assinatura digital do instalador.** O Windows SmartScreen avisa na
  primeira instalacao ate haver um certificado de code signing.
