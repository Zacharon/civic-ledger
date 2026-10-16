import {
  type CapabilityContext,
  CapabilityError,
  type CapabilityName,
  type CapabilityOutput,
  dispatch,
} from '@civic-ledger/core';
import { ZodError } from 'zod';

export interface SmokeFailure {
  capability: CapabilityName;
  label: string;
  input: unknown;
  code: string;
  message: string;
  /** Output-validation issues (path: message), at most five. */
  issues: string[];
}

interface CapabilityStats {
  calls: number;
  failures: number;
  totalMs: number;
  maxMs: number;
  slowest: string;
}

/**
 * Dispatches capabilities exactly as the adapters do and records every outcome. A failure
 * never stops the run: the point is to list every input the real data breaks.
 */
export class SmokeRecorder {
  readonly failures: SmokeFailure[] = [];
  readonly stats = new Map<CapabilityName, CapabilityStats>();
  calls = 0;

  constructor(
    private readonly ctx: CapabilityContext,
    private readonly onProgress: (calls: number, failures: number) => void = () => {},
  ) {}

  async call<N extends CapabilityName>(
    capability: N,
    input: unknown,
    label: string,
  ): Promise<CapabilityOutput<N> | null> {
    const started = performance.now();
    let output: CapabilityOutput<N> | null = null;
    try {
      output = await dispatch(capability, input, this.ctx);
    } catch (error) {
      this.failures.push(describeFailure(capability, label, input, error));
    }
    this.record(capability, label, performance.now() - started, output === null);
    return output;
  }

  private record(capability: CapabilityName, label: string, ms: number, failed: boolean) {
    const s = this.stats.get(capability) ?? {
      calls: 0,
      failures: 0,
      totalMs: 0,
      maxMs: 0,
      slowest: '',
    };
    s.calls += 1;
    s.totalMs += ms;
    if (failed) s.failures += 1;
    if (ms > s.maxMs) {
      s.maxMs = ms;
      s.slowest = label;
    }
    this.stats.set(capability, s);
    this.calls += 1;
    if (this.calls % 250 === 0) this.onProgress(this.calls, this.failures.length);
  }

  summary() {
    return Object.fromEntries(
      [...this.stats].map(([name, s]) => [
        name,
        {
          calls: s.calls,
          failures: s.failures,
          meanMs: Math.round(s.totalMs / s.calls),
          maxMs: Math.round(s.maxMs),
          slowest: s.slowest,
        },
      ]),
    );
  }
}

function describeFailure(
  capability: CapabilityName,
  label: string,
  input: unknown,
  error: unknown,
): SmokeFailure {
  const code = error instanceof CapabilityError ? error.code : 'uncaught';
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const zod = cause instanceof ZodError ? cause : error instanceof ZodError ? error : null;
  const issues = zod
    ? zod.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
    : error instanceof CapabilityError && error.issues
      ? error.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`)
      : cause instanceof Error
        ? [cause.message]
        : [];
  return { capability, label, input, code, message, issues };
}
