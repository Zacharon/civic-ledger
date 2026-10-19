import type { RequestListener, Server } from 'node:http';
export function loadServerAddress(
  args?: string[],
  env?: Record<string, string | undefined>,
): { port: number; hostname: string };
export function loadServerTimeouts(env?: Record<string, string | undefined>): {
  headersTimeout: number;
  requestTimeout: number;
  inactivityTimeout: number;
  keepAliveTimeout: number;
  responseTimeout: number;
};
export function createBoundedServer(
  handler: RequestListener,
  env?: Record<string, string | undefined>,
): Server;
