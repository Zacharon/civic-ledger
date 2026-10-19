#!/usr/bin/env bash
# Preview by default. Requires --manifest <key> --target-database <empty-db>.
# --execute authenticates/decrypts first, refuses populated/source databases and
# restores in one transaction without DROP or --clean. Never pass a URL on argv.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec pnpm exec tsx scripts/backup/cli.ts restore "$@"
