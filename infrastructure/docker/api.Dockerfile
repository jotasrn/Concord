FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages packages
COPY apps/api apps/api
# prisma generate only parses the schema, but still requires the env var to be
# present. The real DATABASE_URL is injected at runtime by docker-compose.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build --workspace=packages/types \
  && npm run build --workspace=packages/shared \
  && npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build --workspace=apps/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/prisma apps/api/prisma
COPY --from=builder /app/apps/api/package.json apps/api/package.json

WORKDIR /app/apps/api
EXPOSE 3333
CMD ["node", "dist/main.js"]
