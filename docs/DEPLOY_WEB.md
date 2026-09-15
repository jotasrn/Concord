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
6. Em **Disks**, adicione disco persistente montado em `/data`
7. Deploy

---

## Rodar localmente (sem Electron)

```bash
# 1. Build dos pacotes
npm run build --workspace=packages/types
npm run build --workspace=packages/shared
npm run build --workspace=packages/core

# 2. Build do frontend React
npm run build --workspace=apps/web

# 3. Instalar deps do servidor
npm install --workspace=apps/server

# 4. Rodar o servidor
npm run dev --workspace=apps/server
# Ou em produção:
npm run build --workspace=apps/server && npm start --workspace=apps/server
```

Acesse: `http://localhost:3001`

---

## Notas de Segurança

- O servidor roda TLS automaticamente quando detecta `NODE_ENV=production` via `X-Forwarded-Proto`
- Os dados de cada conexão WebSocket são **isolados** — cada sessão tem seu próprio diretório
- Rate limit: **5 mensagens por 3 segundos** por canal (igual ao cliente Electron)
- Overlay de gaming **não está disponível** no browser (limitação de plataforma)
- Captura de tela (`desktop:sources`) **não está disponível** no browser

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta HTTP/WebSocket |
| `DATA_DIR` | `~/.concord-server` | Diretório de dados (SQLite, keystores) |
| `NODE_ENV` | `development` | `production` ativa redirect HTTPS |
