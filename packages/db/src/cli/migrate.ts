import { createDb, dbConfigFromEnv } from '../client';
import { runMigrations } from '../migrate';

const config = dbConfigFromEnv(process.env, { batch: true });
const handle = createDb(config);
try {
  await runMigrations(handle);
  console.log(`Migrations applied (${config.kind}).`);
} finally {
  await handle.close();
}
