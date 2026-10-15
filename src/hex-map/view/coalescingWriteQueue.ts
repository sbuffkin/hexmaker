/**
 * A per-key write queue that keeps only the latest value (L2c, the three
 * HexMapView paint queues made one). Rapid repaints of the same hex coalesce
 * into at most one queued write behind the one in flight, so a stale value
 * never lands after a newer one. A failed write is retried with backoff
 * (200 ms doubling, capped at 2 s) until it succeeds.
 *
 * Pure: timing comes in through `sleep`, so tests can drive it.
 */

/** What a write did: "done", or "stop" to end this key's flush (leaving any newer value queued). */
export type WriteOutcome = "done" | "stop";

export interface WriteQueueOpts<V> {
  /** Write one value. Throwing retries the same value. */
  write: (key: string, value: V) => Promise<WriteOutcome>;
  /** Pending or in-flight counts changed (the saving indicator). */
  onChange?: () => void;
  /** A write attempt failed (`attempt` counts from 1). */
  onError?: (key: string, attempt: number, err: unknown) => void;
  /** Wait before a retry. */
  sleep: (ms: number) => Promise<void>;
}

/** The wait before retry `attempt` (1 → 200 ms, doubling, capped at 2 s). */
export function retryDelay(attempt: number): number {
  return Math.min(200 * (1 << (attempt - 1)), 2000);
}

export class CoalescingWriteQueue<V> {
  private pending = new Map<string, V>();
  private flushing = new Set<string>();

  constructor(private opts: WriteQueueOpts<V>) {}

  /** Queue `value` for `key` (replacing any queued, not yet started value) and flush. */
  schedule(key: string, value: V): void {
    this.pending.set(key, value);
    this.opts.onChange?.();
    if (!this.flushing.has(key)) void this.flush(key);
  }

  /** The queued (not yet started) value for `key`. */
  peek(key: string): V | undefined {
    return this.pending.get(key);
  }

  /** Drop the queued (not yet started) value for `key`. */
  discard(key: string): void {
    this.pending.delete(key);
  }

  /** A write for `key` is in flight. */
  isFlushing(key: string): boolean {
    return this.flushing.has(key);
  }

  /** Queued values plus keys being flushed. */
  get count(): number {
    return this.pending.size + this.flushing.size;
  }

  /** Anything queued or in flight. */
  busy(): boolean {
    return this.pending.size > 0 || this.flushing.size > 0;
  }

  private async flush(key: string): Promise<void> {
    this.flushing.add(key);
    this.opts.onChange?.();
    try {
      while (this.pending.has(key)) {
        const value = this.pending.get(key)!;
        this.pending.delete(key);
        let attempt = 0;
        while (true) {
          if (attempt > 0) await this.opts.sleep(retryDelay(attempt));
          try {
            if ((await this.opts.write(key, value)) === "stop") return;
            break; // success
          } catch (err) {
            attempt++;
            this.opts.onError?.(key, attempt, err);
          }
        }
      }
    } finally {
      this.flushing.delete(key);
      this.opts.onChange?.();
    }
  }
}
