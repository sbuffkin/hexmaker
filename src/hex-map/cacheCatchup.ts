/**
 * Redraw a map that was drawn before Obsidian had read its hex notes.
 *
 * The map reads terrain/icons from the metadata cache. When it is drawn while
 * Obsidian is still indexing (first open, a cache rebuild, Sync pulling many
 * notes), notes without a cache entry draw blank, and nothing redrew them once
 * the cache filled in: whole parts of the map stayed empty until reopened.
 *
 * The view reports after each draw whether any hex note lacked a cache entry
 * (`setIncomplete`). While that is true, cache events for the map (`poke`)
 * schedule one redraw, at most one per `intervalMs`. A redraw waits while
 * writes are pending so it never paints over an in-flight edit. Once a draw
 * finds every note cached, pokes do nothing.
 */
export class CacheCatchup {
  private incomplete = false;
  private timer: number | null = null;

  constructor(
    private readonly redraw: () => void,
    private readonly busy: () => boolean,
    private readonly intervalMs = 1000,
  ) {}

  setIncomplete(incomplete: boolean): void {
    this.incomplete = incomplete;
  }

  get pending(): boolean {
    return this.incomplete;
  }

  poke(): void {
    if (!this.incomplete || this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.incomplete) return;
      if (this.busy()) {
        this.poke();
        return;
      }
      this.redraw();
    }, this.intervalMs);
  }

  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
