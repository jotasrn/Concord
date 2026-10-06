# Concord — Versão Web (Deploy)

O Concord pode ser usado no **browser** além do cliente Electron. Para isso é necessário rodar o servidor WebSocket que faz a ponte entre o browser e o core P2P (SQLite, DHT, crypto).

> **Netlify** serve apenas arquivos estáticos e **não suporta** WebSocket persistente ou SQLite. Use um dos provedores abaixo.

---

## Deploy em Railway (recomendado)

1. Crie uma conta em [railway.app](https://railway.app)
2. Novo projeto → **Deploy from GitHub Repo** → selecione este repositório
3. O Railway detecta o `Dockerfile` automaticamente
4. Em **Variables**, adicione:
   - `NODE_ENV=production`
   - `PORT=3001` (ou deixe o Railway atribuir)
   - `TRUST_PROXY=1` (o Railway fica na frente; sem isto o limite por IP ve so o proxy)
5. Em **Volumes**, adicione um volume montado em `/data` para persistência dos dados
6. Deploy → aguarde o build e acesse a URL gerada

---

## Deploy em Render

1. Crie uma conta em [render.com](https://render.com)
2. Novo serviço → **Web Service** → conecte o repositório
3. **Runtime**: Docker
4. **Port**: `3001`
5. Em **Environment Variables**:
   - `NODE_ENV=production`
   - `DATA_DIR=/data`
   - `TRUST_PROXY=1`
6. Em **Disks**, adicione disco persistente montado em `/data`
7. Deploy

---

## Rodar localmente (sem Electron)

Requisito: Node 22+.

```bash
npm install
npm run build                              # compila core, web e a ponte
npm start --workspace=apps/server          # sobe em http://localhost:3001
```

Ou com Docker, igual ao que roda no Railway/Render:

```bash
docker build -t concord-web .
docker run -p 3001:3001 -v concord-data:/data concord-web
```

Acesse: `http://localhost:3001`

## Atualizando uma ponte que ja estava no ar

Versoes anteriores criavam uma pasta por **conexao** (nome UUID direto em
`DATA_DIR`), entao a conta se perdia a cada recarga de pagina. Agora a pasta e
por **dispositivo**, em `DATA_DIR/devices/`. Na primeira inicializacao a ponte
apaga as pastas antigas que nunca chegaram a ter conta e mantem as que tem; o
log mostra quantas de cada. Quem tinha conta numa pasta antiga entra pela
opcao "Ja tenho uma conta - restaurar com a frase" e os peers reenviam o
historico.

---

## Notas de Segurança

- O servidor roda TLS automaticamente quando detecta `NODE_ENV=production` via `X-Forwarded-Proto`
- **Um diretório por dispositivo.** O navegador gera um token aleatório, guarda no `localStorage` e o apresenta ao conectar (`session:hello`). A pasta é `DATA_DIR/devices/<sha256 do token>` — o token nunca vai para o disco. Recarregar a página reabre a mesma conta; a chave privada continua cifrada e só abre com a senha.
- **Uma aba por dispositivo.** Abrir uma segunda aba fecha a primeira (código 4001), em vez de abrir o mesmo SQLite duas vezes.
- **Faxina automática.** Pastas sem conta são apagadas ao desconectar, na inicialização e a cada hora. Pastas de versões antigas (uma por conexão, nome UUID) que têm conta são mantidas; o dono recupera a conta pela frase.
- **Limites:** sessões simultâneas no total e por IP, tamanho máximo de mensagem, chamadas por segundo por conexão e trava após senhas erradas — todos configuráveis abaixo.
- **Origin verificado no handshake:** página de outro domínio é recusada (HTTP 401). Para servir o front em outro domínio, use `ALLOWED_ORIGINS`.
- Rate limit de chat: **5 mensagens por 3 segundos** por canal, por conexão (igual ao cliente Electron)
- Overlay de gaming **não está disponível** no browser (limitação de plataforma)
- Captura de tela (`desktop:sources`) **não está disponível** no browser

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta HTTP/WebSocket |
| `DATA_DIR` | `~/.concord-server` | Diretório de dados (SQLite, keystores) |
| `NODE_ENV` | `development` | `production` ativa redirect HTTPS |
| `TRUST_PROXY` | desligado | `1` para usar `X-Forwarded-For` como IP do cliente (só atrás de proxy) |
| `ALLOWED_ORIGINS` | vazio | Origens extras aceitas, separadas por vírgula (a do próprio host sempre vale) |
| `MAX_SESSIONS` | `50` | Sessões simultâneas no processo |
| `MAX_SESSIONS_PER_IP` | `3` | Sessões simultâneas por IP |
| `MAX_PAYLOAD_BYTES` | `262144` | Maior mensagem WebSocket aceita |
| `CALLS_PER_WINDOW` / `CALL_WINDOW_MS` | `60` / `1000` | Chamadas por janela, por conexão |
| `MAX_UNLOCK_FAILURES` / `UNLOCK_LOCKOUT_MS` | `5` / `60000` | Senhas erradas antes de travar, e por quanto tempo |
