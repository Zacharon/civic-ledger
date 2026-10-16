import { z } from 'zod';

export const ERROR_CODES = [
  'invalid_input',
  'not_found',
  'conflict',
  'rate_limited',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status each error code maps to in the `/api/v1` adapter. */
export const HTTP_STATUS_BY_ERROR: Record<ErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export const IssueSchema = z.object({
  path: z.string().describe('Dotted path to the offending field; empty for the whole input.'),
  message: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

/** Wire format for every adapter (API body, MCP tool error content). */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    issues: z.array(IssueSchema).optional(),
    retryAfterSeconds: z.int().positive().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export interface CapabilityErrorOptions {
  issues?: Issue[];
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class CapabilityError extends Error {
  readonly code: ErrorCode;
  readonly issues: Issue[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, message: string, options: CapabilityErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'CapabilityError';
    this.code = code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** Never includes `cause`: internal details stay in logs, not responses. */
  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues ? { issues: this.issues } : {}),
        ...(this.retryAfterSeconds ? { retryAfterSeconds: this.retryAfterSeconds } : {}),
      },
    };
  }
}

export function invalidInput(
  error: z.ZodError,
  message = 'Input failed validation',
): CapabilityError {
  return new CapabilityError('invalid_input', message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

export function notFound(message: string): CapabilityError {
  return new CapabilityError('not_found', message);
}
