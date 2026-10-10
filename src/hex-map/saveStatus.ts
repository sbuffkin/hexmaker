/**
 * The hex editor's autosave status. Round-3 testers reopened hexes to check
 * their text had stuck, because nothing said it had; round 4 added a brief
 * "✓ Saved" in the title row, which 2 of 3 testers still missed (it was
 * small, far from the box they were typing in, and vanished after 2 s).
 *
 * So the status is now persistent: it always says where things stand
 * ("Changes save automatically" → "Saving shortly…" while typing → "Saving…"
 * → "✓ All changes saved"), and HexEditorModal shows it next to the text box
 * being edited as well as in the title row. "saved" is the fresh state (shown
 * in the success colour for a moment); it then settles to "settled" with the
 * same words in a quieter colour. DOM-free so it can be unit-tested.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "settled" | "error";

export const SAVE_STATUS_TEXT: Record<SaveState, string> = {
  idle: "Changes save automatically",
  // Round 6: "Not saved yet…" with no Save button made testers fear closing
  // would lose their text. It won't: closing the editor saves at once.
  pending: "Saving shortly…",
  saving: "Saving…",
  saved: "✓ All changes saved",
  settled: "✓ All changes saved",
  error: "Couldn't save",
};

/** Tooltip on the status: what "automatically" means. */
export const SAVE_STATUS_TITLE = "Saves a moment after you stop typing, and when you close the editor. There is no Save button.";

/** How long the fresh "saved" colour stays before settling. */
export const SAVED_SHOWN_MS = 2500;

export class SaveTracker {
  private inFlight = 0;
  private failed = false;
  /** Typed-but-not-yet-saved edits exist (see markPending). */
  private dirty = false;
  /** What to show when nothing is pending or in flight. */
  private rest: SaveState = "idle";
  private state: SaveState = "idle";
  private timer: number | null = null;

  constructor(
    private render: (state: SaveState) => void,
    private setTimer: (fn: () => void, ms: number) => number,
    private clearTimer: (id: number) => void,
  ) {}

  get current(): SaveState {
    return this.state;
  }

  /** Something was typed and will autosave shortly. */
  markPending(): void {
    this.dirty = true;
    if (this.inFlight === 0) this.show("pending");
  }

  /** The pending edit turned out to need no write (text unchanged). */
  settle(): void {
    this.dirty = false;
    if (this.inFlight === 0 && this.state === "pending") this.show(this.rest);
  }

  /** Show "Saving…" until `work` (and any other tracked save) settles, then
   *  "✓ All changes saved" — or "Couldn't save" if any of them failed. */
  async track(work: Promise<unknown>): Promise<void> {
    this.inFlight++;
    this.dirty = false;
    this.show("saving");
    try {
      await work;
    } catch (err) {
      this.failed = true;
      console.error("Hexmaker: save failed", err);
    } finally {
      this.inFlight--;
      if (this.inFlight === 0) {
        if (this.failed) {
          this.rest = "error";
          this.show("error");
        } else {
          this.rest = "settled";
          this.show(this.dirty ? "pending" : "saved");
        }
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
    this.state = state;
    this.render(state);
    if (state === "saved") {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.state = "settled";
        this.render("settled");
      }, SAVED_SHOWN_MS);
    }
  }
}

/**
 * "Save a moment after typing stops": each schedule() restarts the
 * countdown; cancel() drops it (call it when saving now, e.g. on blur).
 * Timers are injected so the transitions can be unit-tested.
 */
export class DebouncedSave {
  private timer: number | null = null;

  constructor(
    private save: () => void,
    private ms: number,
    private setTimer: (fn: () => void, ms: number) => number,
    private clearTimer: (id: number) => void,
  ) {}

  /** A save is counting down. */
  get pending(): boolean {
    return this.timer !== null;
  }

  schedule(): void {
    this.cancel();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.save();
    }, this.ms);
  }

  cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
