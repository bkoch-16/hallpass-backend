#!/bin/sh
set -e
echo "Running Prisma migrations..."
pnpm --filter @hallpass/db exec prisma migrate deploy
echo "Starting schools-api..."
exec node apps/schools-api/dist/index.js
