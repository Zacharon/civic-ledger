import type { LoadCounts } from '../adapter';

/** Integer counters for a run receipt; every declared key is reported, even when zero. */
export class Counts<K extends string> {
  private readonly values = new Map<K, number>();

  constructor(keys: readonly K[]) {
    for (const key of keys) this.values.set(key, 0);
  }

  add(key: K, n = 1): void {
    this.values.set(key, (this.values.get(key) ?? 0) + n);
  }

  set(key: K, n: number): void {
    this.values.set(key, n);
  }

  get(key: K): number {
    return this.values.get(key) ?? 0;
  }

  toJSON(): LoadCounts {
    return Object.fromEntries(this.values);
  }
}
