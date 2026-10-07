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

## Baixar

<p>
  <a href="https://github.com/jotasrn/Concord/releases/latest/download/Concord-Setup.exe">
    <img alt="Baixar instalador para Windows" src="https://img.shields.io/badge/Baixar-Instalador%20Windows-8B5CF6?style=for-the-badge&logo=windows&logoColor=white">
  </a>
  <a href="https://github.com/jotasrn/Concord/releases/latest/download/Concord-Portable.zip">
    <img alt="Baixar versao portatil" src="https://img.shields.io/badge/Baixar-Port%C3%A1til%20(.zip)-24242E?style=for-the-badge&logo=files&logoColor=white">
  </a>
</p>

Windows 10/11, 64 bits. Os botoes baixam sempre a versao mais nova.
Passo a passo de instalacao, o aviso do SmartScreen, onde ficam os dados e
problemas comuns: **[download/](download/README.md)**.

Depois de instalado o app se atualiza sozinho.

[![CI](https://github.com/jotasrn/Concord/actions/workflows/ci.yml/badge.svg)](https://github.com/jotasrn/Concord/actions/workflows/ci.yml)
![Versao](https://img.shields.io/github/v/release/jotasrn/Concord?label=versao&color=8B5CF6)
[![Wiki](https://img.shields.io/badge/Documenta%C3%A7%C3%A3o-Wiki%20Oficial-10B981?style=flat&logo=bookstack&logoColor=white)](https://github.com/jotasrn/Concord/wiki)

## O que ja funciona

- **Servidores e canais** - texto e voz, com convite cifrado ponta a ponta
- **Chat** - links clicaveis, edicao e apagar mensagem propria
- **Voz** - AEC/NS/AGC, deteccao de fala por limiar relativo ao ruido, perfil
  de latencia ultra-baixa (Opus a 10ms, jitter buffer zerado)
- **Video, webcam e compartilhamento de tela** - transmissao de webcam em chamadas,
  compartilhamento de tela em ate 4K (Ultra HD), codec AV1/VP9 quando disponivel,
  pausa sem derrubar a chamada, picture-in-picture, tela cheia
- **Chat e comunicacao** - respostas e citacoes de mensagens (`reply_to`), formatacao rica,
  historico assinado descentralizado
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
- **Seguranca do executavel** - Electron 42 com sandbox, DevTools bloqueado
  em producao, sem sourcemap, fuses do Electron (sem `RUN_AS_NODE`,
  integridade do asar)

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
packages/config Configuracao base do TypeScript
download/       Como baixar e instalar (para quem so quer usar o app)
docs/           Arquitetura, seguranca, atualizacao, WebRTC, deploy web
```

Descricao arquivo por arquivo em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rodar em desenvolvimento

Requisito: **Node 22+**.

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
proposito - OneDrive trava o `asar` no meio do empacotamento). Produz o
instalador `Concord-Setup-<versao>.exe` e a versao sem instalacao
`Concord-Portable-<versao>.zip`.

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
| `npm run lint` | ESLint em todo o monorepo |
| `npm run format` | Formata com Prettier (`format:check` so confere) |
| `npm run dist` | Gera o instalador local, sem publicar |
| `npm run dist --workspace=apps/desktop` | Idem, direto no workspace |

## Testes

```bash
npm test
```

- **`packages/core`** (88): convergencia entre peers, assinatura e verificacao
  de operacoes, sincronizacao apos ficar offline, protocolo de enquadramento,
  validacao de sinal de voz e um conjunto adversarial (payload nulo, tipo
  errado, mensagem gigante, uma operacao invalida que nao pode derrubar as
  demais).
- **`apps/web`** (38): transporte de voz P2P contra um WebRTC simulado
  (colisao de offers, candidates fora de ordem, tela, recuperacao de
  conexao), ajuste de SDP do Opus, detector de voz e token de dispositivo.
- **`apps/server`** (25): ponte web de ponta a ponta via WebSocket real -
  sessao por dispositivo, faxina de pastas, limites, Origin, trava de senha.

O CI roda lint, formatacao, build, testes, `npm audit` (bloqueante) e CodeQL.

## Documentacao & Wiki

Acesse a **[Wiki Oficial do Concord](https://github.com/jotasrn/Concord/wiki)** no GitHub para ver a documentacao completa e ilustrada com 9 modulos.

- [Wiki Oficial](https://github.com/jotasrn/Concord/wiki) - Guia completo com 9 modulos ilustrados
- [download/](download/README.md) - instalar, atualizar, desinstalar,
  problemas comuns (para quem usa o app)
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - os tres processos, o log
  assinado, arquivo por arquivo do que existe
- [SECURITY.md](docs/SECURITY.md) - identidade, cifragem, moderacao, ponte
  web, seguranca do executavel e o que continua em aberto
- [ATUALIZACAO.md](docs/ATUALIZACAO.md) - como o auto-update funciona, como
  publicar uma versao e o que o release gera
- [DEPLOY_WEB.md](docs/DEPLOY_WEB.md) - rodar a ponte WebSocket para acesso
  pelo navegador
- [WEBRTC.md](docs/WEBRTC.md) - sinalizacao, perfis de latencia, codecs e
  como o transporte e testado sem navegador

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
