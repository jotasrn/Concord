# 🎮 Bem-vindo à Wiki do Concord

O **Concord** é uma plataforma de comunicação em tempo real projetada especificamente para gamers, comunidades e desenvolvedores que valorizam **privacidade absoluta, resiliência e controle total sobre seus dados**.

Diferente do Discord, Slack ou Teams, o Concord adota uma arquitetura **100% descentralizada (Peer-to-Peer, Local-First)**: **não existe servidor central**. Não há banco de dados na nuvem onde suas conversas são armazenadas ou mineradas. Cada dispositivo é seu próprio servidor, guardando seus próprios dados e sincronizando diretamente com seus amigos.

---

## 🌟 Principais Destaques

- **🚫 Sem Servidor Central (P2P)**: Mensagens, canais e arquivos trafegam diretamente entre os participantes através da DHT do [Hyperswarm](https://github.com/holepunchto/hyperswarm).
- **🔒 Criptografia Ponta a Ponta Real**: 
  - Conexões de rede autenticadas com protocolo Noise.
  - Cifragem por servidor usando chaves simétricas de 256 bits (AES-256-GCM).
  - Conteúdo local protegido no disco via Vault com derivação scrypt.
- **🎙️ Voz de Ultra Baixa Latência**: Pipeline de áudio calibrado para jogos competitivos (Opus 48kHz, empacotamento de 10ms, supressão de ruído inteligente e controle de ganho).
- **📹 Webcam e Vídeo em Grade**: Suporte nativo à ativação de câmeras durante chamadas com layout dinâmico e responsivo.
- **🖥️ Transmissão de Tela em até 4K @ 60 FPS**: Presets otimizados para jogos, vídeos ou leitura de código com priorização dos codecs AV1, VP9 e VP8.
- **💬 Chat Avançado com Respostas Encadeadas**: Suporte a citações e respostas diretas (`reply_to`), histórico replicado via CRDT imutável e ordenação determinística por relógios de Lamport.
- **🛡️ Identidade Soberana**: Sem e-mails, sem senhas armazenadas remotamente. Sua conta é um par de chaves assimétricas **Ed25519**, gerada a partir de uma **frase mnemônica BIP-39 de 12 palavras**.
- **🌐 Dual-Mode (Desktop & Web)**: Roda nativamente no Windows com Electron (suporte a overlay transparente em jogos) e também em qualquer navegador via servidor de ponte WebSocket.

---

## 🗺️ Mapa da Documentação

Navegue pelos módulos detalhados da nossa Wiki através dos links abaixo ou pela barra lateral à direita:

| Seção | Descrição |
|---|---|
| **[[1. Visão Geral e Instalação|1.-Visao-Geral-e-Instalacao]]** | Como baixar o executável, executar via navegador e criar sua conta com a frase de segurança. |
| **[[2. Arquitetura e Criptografia|2.-Arquitetura-e-Criptografia]]** | Como o Concord funciona por baixo do capô: separação de processos, isolamento Sandbox e camadas criptográficas. |
| **[[3. Protocolo P2P e CRDT|3.-Protocolo-P2P-e-CRDT]]** | Descoberta distribuída (DHT), convergência assíncrona, ordem total determinística e sincronização offline. |
| **[[4. Voz, Vídeo e Tela 4K|4.-Voz,-Video-e-Transmissao-4K]]** | Protocolo WebRTC full-mesh, sinalização P2P, áudio competitivo, webcam e streaming em resolução Ultra HD. |
| **[[5. Servidores, Canais e Chat|5.-Servidores,-Canais-e-Mensagens]]** | Como criar servidores, convidar membros com códigos criptografados, organizar canais e moderar com cargos. |
| **[[6. Deploy da Ponte Web|6.-Deploy-do-Servidor-Web]]** | Como hospedar a versão web em Docker, Railway, Render, Coolify ou VPS com proteção por rate limiting. |
| **[[7. Segurança e Modelo de Ameaças|7.-Seguranca-e-Permissoes]]** | Análise detalhada do modelo de segurança descentralizado, defesas no reducer e mitigação de peers maliciosos. |
| **[[8. Guia do Desenvolvedor|8.-Guia-do-Desenvolvedor]]** | Como clonar o monorepo, rodar localmente, executar a suíte de 152 testes e contribuir com o projeto. |
| **[[9. FAQ e Solução de Problemas|9.-FAQ-e-Solucao-de-Problemas]]** | Respostas para as dúvidas mais frequentes, diagnóstico de conectividade, firewall e NAT traversal. |

---

## 🚀 Como Começar em 1 Minuto

1. **Baixe o Instalador**: Acesse a página de [Releases do GitHub](https://github.com/jotasrn/Concord/releases) e faça o download do `Concord-Setup.exe` (ou da versão portátil `Concord-Portable.zip`).
2. **Crie sua Identidade**: Abra o aplicativo, escolha seu nome de exibição e anote com atenção a sua **frase de 12 palavras**. Guarde-a em um lugar seguro; ela é a única forma de recuperar sua conta caso troque de computador!
3. **Crie ou Entre em um Servidor**:
   - Para criar: clique no botão `+` na barra lateral esquerda e dê um nome ao seu servidor.
   - Para convidar alguém: clique no nome do servidor, copie o **código de convite** e envie para seu amigo.
4. **Conecte-se e Converse**: Entre em um canal de texto ou voz, ligue sua câmera ou compartilhe sua tela em alta resolução sem limites artificiais!
