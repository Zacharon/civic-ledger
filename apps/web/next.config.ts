import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@civic-ledger/core', '@civic-ledger/db'],
  // Native/WASM database drivers stay as runtime requires on the server.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
};

export default config;
