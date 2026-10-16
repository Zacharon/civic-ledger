export interface SessionLimiterOptions {
  /** Burst size, also the starting balance. */
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

export type SessionLimit = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * One token bucket per MCP session (one stdio process = one session). Mirrors the
 * `/api/v1` per-IP limiter: a call costs one token and the bucket refills smoothly.
 */
export class SessionLimiter {
  private tokens: number;
  private updatedAt: number;
  private readonly now: () => number;

  constructor(private readonly options: SessionLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.updatedAt = this.now();
  }

  take(): SessionLimit {
    const { capacity, refillPerSecond } = this.options;
    const now = this.now();
    this.tokens = Math.min(
      capacity,
      this.tokens + ((now - this.updatedAt) / 1000) * refillPerSecond,
    );
    this.updatedAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - this.tokens) / refillPerSecond)),
    };
  }
}

/** 120-call burst, 2 calls per second sustained, per session. */
export const DEFAULT_SESSION_LIMIT: SessionLimiterOptions = { capacity: 120, refillPerSecond: 2 };
