/**
 * The shared save-status line for autosaving editors (UI consistency
 * standard 12, owner Q5 2026-10-13): no Save / Cancel / Close button, ×
 * closes, and this line says where things stand, as in the hex editor
 * ("Changes save automatically" → "Saving…" → "✓ All changes saved").
 * The state machine is src/hex-map/saveStatus.ts (DOM-free, tested).
 */

import { SAVE_STATUS_TEXT, SaveTracker, type SaveState } from "../hex-map/saveStatus";

export interface SaveStatusLine {
  el: HTMLElement;
  /** Something changed and will save shortly. */
  pending(): void;
  /** Show "Saving…" until `work` settles, then saved (or "Couldn't save"). */
  track(work: Promise<unknown>): Promise<void>;
  readonly state: SaveState;
  dispose(): void;
}

/** Hover text: what "automatically" means on an editor with no Save button. */
export const SAVE_LINE_TITLE = "Saves as you go, and when you close this. There is no Save button.";

export function renderSaveStatusLine(parent: HTMLElement, opts: { title?: string; cls?: string } = {}): SaveStatusLine {
  const el = parent.createDiv({
    cls: "duckmage-editor-notes-status duckmage-save-status-line" + (opts.cls ? ` ${opts.cls}` : ""),
    attr: { "aria-live": "polite", title: opts.title ?? SAVE_LINE_TITLE },
  });
  const win = () => el.ownerDocument?.defaultView ?? activeWindow;
  const render = (state: SaveState) => {
    el.setText(SAVE_STATUS_TEXT[state]);
    el.setAttr("data-state", state);
  };
  const tracker = new SaveTracker(render, (fn, ms) => win().setTimeout(fn, ms), (id) => win().clearTimeout(id));
  render("idle");
  return {
    el,
    pending: () => tracker.markPending(),
    track: (work) => tracker.track(work),
    get state() {
      return tracker.current;
    },
    dispose: () => tracker.dispose(),
  };
}
