# Deploy

> **Estado:** as imagens de producao existem e sao construidas pelo compose (`--profile full`).
> O deploy em provedor real e a Fase 15.

## Imagens

| Servico | Dockerfile                             | Runtime                          |
| ------- | -------------------------------------- | -------------------------------- |
| `api`   | `infrastructure/docker/api.Dockerfile` | Node 22 alpine, multi-stage      |
| `web`   | `infrastructure/docker/web.Dockerfile` | nginx alpine servindo o bundle   |

Ambas usam build multi-stage: o estagio `builder` instala dependencias e compila; o estagio final
carrega apenas o resultado.

O `web.Dockerfile` usa nginx com fallback de SPA (`try_files ... /index.html`), necessario porque o
React Router controla as rotas no cliente.

O `api.Dockerfile` define um `DATABASE_URL` placeholder em build time: `prisma generate` exige a
variavel presente para parsear o schema, mas nao conecta ao banco. O valor real e injetado em
runtime pelo compose.

## Validar as imagens localmente

```bash
docker compose --profile full up -d --build
```

Sem o profile, `docker compose up -d` sobe apenas **postgres**, **redis** e **coturn** — o modo de
desenvolvimento, com os apps rodando via `npm run dev` e hot reload.

## Checklist de producao

### Segredos

- [ ] `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` com 32+ bytes aleatorios e distintos entre si
- [ ] Senha do PostgreSQL diferente da de desenvolvimento
- [ ] Segredos vindos do gerenciador de secrets do provedor, nao de `.env` em disco
- [ ] `API_CORS_ORIGIN` apontando para o dominio real (nunca `*`)

### Banco

- [ ] `npm run prisma:deploy --workspace=apps/api` (nao `migrate dev`, que gera migrations)
- [ ] Backup automatico e restore testado
- [ ] Postgres nao exposto publicamente

### TURN

- [ ] `external-ip` configurado com o IP publico do host
- [ ] `use-auth-secret` com credenciais temporarias, no lugar do usuario fixo
- [ ] TLS habilitado na porta 5349
- [ ] Firewall: 3478/udp, 3478/tcp, 5349/tcp e a faixa de relay 49160–49200/udp

Detalhes em [WEBRTC.md](WEBRTC.md#producao).

### Aplicacao

- [ ] HTTPS obrigatorio — `getUserMedia` e `getDisplayMedia` **so funcionam em contexto seguro**
      (HTTPS ou `localhost`). Sem TLS, voz, camera e compartilhamento de tela nao funcionam.
- [ ] WebSocket sobre `wss://`
- [ ] Redis com senha e fora da rede publica
- [ ] Health check do orquestrador apontando para `/api/health`

## Escala horizontal

Ao rodar mais de uma instancia da API:

1. Adicionar o `@socket.io/redis-adapter` — sem ele, sockets em processos diferentes nao recebem
   os broadcasts uns dos outros.
2. Load balancer com **sticky sessions** ou transporte WebSocket puro (o long-polling do
   Socket.IO exige afinidade de sessao).
3. A API e stateless fora do Redis: sessoes ficam em refresh tokens no banco e presence no Redis.

O gargalo de midia nao escala com instancias de API — ele e o coturn (banda de relay) e, acima de
~6 participantes por call, a topologia em malha. A migracao para SFU esta discutida em
[ARCHITECTURE.md](ARCHITECTURE.md#4-webrtc-malha-mesh-no-mvp-sfu-depois).
