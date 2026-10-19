#!/usr/bin/env bash
# Human/automation adapter over the same environment-only backup command.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec pnpm exec tsx scripts/backup/cli.ts backup "$@"
