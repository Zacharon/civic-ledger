import { createDb, dbConfigFromEnv } from '../client';
import { runMigrations } from '../migrate';
import { seedDevData } from '../seed';

// Fictional data must never land in a shared database by accident.
const config = dbConfigFromEnv(process.env, { batch: true });
if (config.kind === 'pg' && !process.argv.includes('--allow-postgres')) {
  console.error(
    'Refusing to load the fictional dev seed into DATABASE_URL. Pass --allow-postgres to override.',
  );
  process.exit(1);
}

const handle = createDb(config);
try {
  await runMigrations(handle);
  const { ingestRunId, counts } = await seedDevData(handle.db);
  console.log(`Fictional dev seed loaded (${config.kind}, ingest_run ${ingestRunId}).`);
  console.table(counts);
} finally {
  await handle.close();
}
