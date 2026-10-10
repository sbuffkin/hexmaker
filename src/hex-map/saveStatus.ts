/**
 * The hex editor's small autosave cue ("Saving…" → "✓ Saved"). Round-3
 * testers reopened hexes to check their text had stuck, because nothing said
 * it had. DOM-free so it can be unit-tested; HexEditorModal renders it.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

export const SAVE_STATUS_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "✓ Saved",
  error: "Couldn't save",
};

/** How long "✓ Saved" stays up. */
export const SAVED_SHOWN_MS = 2000;

export class SaveTracker {
  private pending = 0;
  private failed = false;
  private timer: number | null = null;

  constructor(
    private render: (state: SaveState) => void,
    private setTimer: (fn: () => void, ms: number) => number,
    private clearTimer: (id: number) => void,
  ) {}

  /** Show "Saving…" until `work` (and any other tracked save) settles, then
   *  "✓ Saved" for a moment — or "Couldn't save" if any of them failed. */
  async track(work: Promise<unknown>): Promise<void> {
    this.pending++;
    this.show("saving");
    try {
      await work;
    } catch (err) {
      this.failed = true;
      console.error("Hexmaker: save failed", err);
    } finally {
      this.pending--;
      if (this.pending === 0) {
        this.show(this.failed ? "error" : "saved");
        this.failed = false;
      }
    }
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private show(state: SaveState): void {
    this.dispose();
    this.render(state);
    if (state === "saved") {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.render("idle");
      }, SAVED_SHOWN_MS);
    }
  }
}
