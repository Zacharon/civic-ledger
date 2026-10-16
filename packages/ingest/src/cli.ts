import { SOURCE_IDS, SourceIdSchema } from '@civic-ledger/core';
import { Command } from 'commander';

/** `pnpm ingest <source>`: operator entry point for ingest.run@1. Adapters land in phase 2. */
const program = new Command('ingest')
  .description('Fetch, parse and load one public data source (operator only).')
  .argument('<source>', `one of: ${SOURCE_IDS.join(', ')}`)
  .action((source: string) => {
    const parsed = SourceIdSchema.safeParse(source);
    if (!parsed.success) {
      program.error(`Unknown source "${source}". Expected one of: ${SOURCE_IDS.join(', ')}`);
    }
    console.error(`ingest ${source}: not implemented`);
    process.exitCode = 1;
  });

await program.parseAsync();
