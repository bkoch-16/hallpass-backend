#!/bin/sh
set -e
echo "Running Prisma migrations..."
pnpm --filter @hallpass/db exec prisma migrate deploy
echo "Starting passes-api..."
exec node apps/passes-api/dist/index.js
