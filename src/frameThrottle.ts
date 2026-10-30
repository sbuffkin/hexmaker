/**
 * Run a job at most once per animation frame: repeated requests within a
 * frame coalesce into one run (the last job wins). Unlike a trailing
 * debounce it keeps firing during a continuous stroke. Pure.
 */
export class FrameThrottle {
  private pending: (() => void) | null = null;
  private scheduled = false;

  constructor(private raf: (cb: () => void) => unknown) {}

  request(job: () => void): void {
    this.pending = job;
    if (this.scheduled) return;
    this.scheduled = true;
    this.raf(() => {
      this.scheduled = false;
      const run = this.pending;
      this.pending = null;
      run?.();
    });
  }

  /** Is a run waiting for the next frame? */
  get waiting(): boolean {
    return this.scheduled;
  }
}
