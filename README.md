# hallpass-backend

Monorepo for HallPass backend services, built with pnpm workspaces and Turborepo.

## Structure

- `apps/user-api` - User management REST API (Express)
- `packages/auth` - Authentication layer (better-auth)
- `packages/db` - Database access layer (Prisma + PostgreSQL)

## Getting Started

```bash
pnpm install
docker-compose up -d
pnpm --filter @hallpass/db db:migrate
pnpm dev
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all services in dev mode |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format all files with Prettier |
| `pnpm format:check` | Check formatting without writing |

## Upcoming

- **`packages/logger`** - Shared logging package for use across APIs
- **`packages/types`** - Shared type definitions for use across APIs
- **Redis** - Coordinate state across Cloud Run instances
