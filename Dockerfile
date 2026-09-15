FROM node:20-alpine AS base
WORKDIR /app

# Instala dependencias
COPY package.json package-lock.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
RUN npm ci --workspace=packages/types --workspace=packages/shared --workspace=packages/core \
    --workspace=apps/web --workspace=apps/server

# Build dos pacotes core
FROM base AS builder
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/core

# Build do frontend React
RUN npm run build --workspace=apps/web

# Build do servidor
RUN npm run build --workspace=apps/server

# Imagem final minima
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3001

# DATA_DIR pode ser montado como volume para persistencia
ENV DATA_DIR=/data
VOLUME /data

CMD ["node", "apps/server/dist/index.js"]
