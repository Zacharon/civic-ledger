import { loadApiConfig } from './config';
import { getApiContext } from './context';
import { createGuard, type Guard } from './guard';
import { createCapabilityHandler } from './handler';
import { createHealthHandler } from './health';
import { createLogger } from './logger';
import { InMemoryRateLimiter } from './rate-limit';

/**
 * Process-wide wiring used by the Next route files and `proxy.ts`. Everything is built lazily so
 * importing a route never opens a database or reads the environment at build time.
 * To share rate limits across instances, pass a different `RateLimiter` to `createGuard`.
 */
let logger: ReturnType<typeof createLogger> | undefined;
let capabilityHandler: ReturnType<typeof createCapabilityHandler> | undefined;
let healthHandler: ReturnType<typeof createHealthHandler> | undefined;
let guard: Guard | undefined;

export function apiLogger() {
  logger ??= createLogger();
  return logger;
}

export function apiCapabilityHandler() {
  capabilityHandler ??= createCapabilityHandler({ context: getApiContext, logger: apiLogger() });
  return capabilityHandler;
}

export function apiHealthHandler() {
  healthHandler ??= createHealthHandler({
    context: getApiContext,
    config: loadApiConfig().health,
    logger: apiLogger(),
  });
  return healthHandler;
}

export function apiGuard(): Guard {
  guard ??= createGuard({
    limiter: new InMemoryRateLimiter(),
    config: loadApiConfig().rateLimit,
    logger: apiLogger(),
  });
  return guard;
}
