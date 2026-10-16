/**
 * Receipt text for an error. Drizzle wraps database errors as "Failed query: <sql> params:
 * <every bound value>", which hides the database's own message behind kilobytes of batch
 * parameters; the receipt shows the innermost cause and the start of the statement.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let inner: Error = error;
  while (inner.cause instanceof Error) inner = inner.cause;
  if (inner === error) return error.message;
  if (error.message.startsWith('Failed query:')) {
    const statement =
      error.message.slice('Failed query:'.length).split('\nparams:')[0]?.trim() ?? '';
    return `${inner.message} [query: ${statement.slice(0, 120)}]`;
  }
  return `${error.message}: ${inner.message}`;
}
