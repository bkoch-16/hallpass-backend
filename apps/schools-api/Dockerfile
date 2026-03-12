FROM node:22-alpine
RUN npm install -g pnpm@10
WORKDIR /app

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/logger/package.json packages/logger/
COPY packages/types/package.json packages/types/
COPY apps/schools-api/package.json apps/schools-api/

RUN pnpm install --frozen-lockfile

# Copy source after install (code change doesn't bust the deps layer)
COPY packages/ packages/
COPY apps/schools-api/ apps/schools-api/

# Generate Prisma client from schema (must happen after schema is copied)
# DATABASE_URL is only needed to satisfy prisma.config.ts — generate doesn't connect to a DB
RUN DATABASE_URL=postgresql://build:build@localhost/build \
    pnpm --filter @hallpass/db exec prisma generate

# Build in dependency order
RUN pnpm --filter @hallpass/db build && \
    pnpm --filter @hallpass/auth build && \
    pnpm --filter @hallpass/logger build && \
    pnpm --filter @hallpass/types build && \
    pnpm --filter @hallpass/schools-api build

COPY apps/schools-api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3002
ENTRYPOINT ["/docker-entrypoint.sh"]
