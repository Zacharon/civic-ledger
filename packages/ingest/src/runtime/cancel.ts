/**
 * Run cancellation (DECISIONS A52). One signal combines the operator's abort (SIGINT), the
 * optional whole-run deadline and the source-lock connection. It is checked at every
 * phase boundary and before every parsed record, so an abort stops the run at the next
 * record or statement boundary (a statement already running finishes first, bounded by
 * the statement timeout). Before the load transaction commits, an abort rolls everything
 * back; the commit itself is the irrevocable boundary.
 */
export class RunControl {
  readonly signal: AbortSignal;
  private readonly deadline = new AbortController();
  private readonly deadlineAt: number | null;
  private readonly timer: NodeJS.Timeout | null;

  constructor(
    private readonly operator: AbortSignal | undefined,
    private readonly lock: AbortSignal,
    private readonly deadlineMs: number | undefined,
  ) {
    this.deadlineAt = deadlineMs === undefined ? null : Date.now() + deadlineMs;
    this.timer =
      deadlineMs === undefined ? null : setTimeout(() => this.expire(deadlineMs), deadlineMs);
    this.timer?.unref();
    const signals = [lock, this.deadline.signal];
    if (operator) signals.push(operator);
    this.signal = AbortSignal.any(signals);
  }

  private expire(deadlineMs: number): void {
    if (!this.deadline.signal.aborted) {
      this.deadline.abort(new Error(`run deadline of ${deadlineMs} ms exceeded`));
    }
  }

  /** Throws the abort reason if the run must stop. */
  checkpoint(): void {
    // The timer cannot fire while a synchronous parse holds the event loop; the clock can.
    if (
      this.deadlineAt !== null &&
      this.deadlineMs !== undefined &&
      Date.now() >= this.deadlineAt
    ) {
      this.expire(this.deadlineMs);
    }
    this.signal.throwIfAborted();
  }

  /**
   * `cancelled` (operator abort or deadline) versus `failed` (lost lock, or any error).
   * A lost lock wins: the run did not stop by choice.
   */
  cancellationReason(): string | null {
    if (this.lock.aborted) return null;
    const reason = this.operator?.aborted
      ? this.operator.reason
      : this.deadline.signal.aborted
        ? this.deadline.signal.reason
        : null;
    if (reason === null) return null;
    return reason instanceof Error ? reason.message : String(reason);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Re-yields `items`, checking the run before each one: the parse/load cancellation point. */
export async function* abortable<T>(
  items: AsyncIterable<T>,
  control: RunControl,
): AsyncGenerator<T> {
  control.checkpoint();
  for await (const item of items) {
    control.checkpoint();
    yield item;
  }
}
