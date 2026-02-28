#!/bin/sh
set -e
echo "Running Prisma migrations..."
pnpm --filter @hallpass/db exec prisma migrate deploy
echo "Starting user-api..."
exec node apps/user-api/dist/index.js
