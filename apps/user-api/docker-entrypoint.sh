#!/bin/sh
set -e
# Migrations run once in the deploy pipeline (migrate-{env} job), not per
# container — see .github/workflows/deploy.yml and docs/INFRA.md.
exec node apps/user-api/dist/index.js
