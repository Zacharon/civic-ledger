# Optional operator image for a trusted runner. Not deployed by the Blueprint.
#
# pg_dump/restore must match PostgreSQL major 17. Node's crypto provides authenticated
# AES-256-GCM encryption. PGDG packages use apt signature verification. No npm dependency
# is added. Build context: repository root. The first build needs network access.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg awscli \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN npm install --global pnpm@11.13.1 && pnpm install --frozen-lockfile

CMD ["pnpm", "exec", "tsx", "scripts/backup/cli.ts", "backup"]
