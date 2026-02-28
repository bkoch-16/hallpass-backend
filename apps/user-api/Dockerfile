FROM node:22-alpine
RUN npm install -g pnpm@10
WORKDIR /app

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY apps/user-api/package.json apps/user-api/

RUN pnpm install --frozen-lockfile

# Copy source after install (code change doesn't bust the deps layer)
COPY packages/ packages/
COPY apps/user-api/ apps/user-api/

# Generate Prisma client from schema (must happen after schema is copied)
# DATABASE_URL is only needed to satisfy prisma.config.ts — generate doesn't connect to a DB
RUN DATABASE_URL=postgresql://build:build@localhost/build \
    pnpm --filter @hallpass/db exec prisma generate

# Build in dependency order
RUN pnpm --filter @hallpass/db build && \
    pnpm --filter @hallpass/auth build && \
    pnpm --filter @hallpass/user-api build

COPY apps/user-api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/docker-entrypoint.sh"]
