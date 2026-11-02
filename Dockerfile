# syntax=docker/dockerfile:1
#
# Production image for the ShopRoom API.
#   docker build -t shoproom-backend .
#   docker run --env-file .env.production -p 3001:3001 shoproom-backend
#
# Migrations are a separate, explicit step (they must run once per release, not
# once per container):  docker run --rm --env-file .env.production shoproom-backend \
#                          pnpm exec prisma migrate deploy
# The image keeps the Prisma CLI for that reason.

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
# prisma.config.ts requires a URL even for `prisma generate`, which never connects.
# An ARG, so the placeholder does not end up in the image's environment.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm exec prisma generate && pnpm build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
