/**
 * ShareSliders: the shared zero-sum slider control (owner 2026-10-12: the same kind of
 * input uses the same control everywhere). One row per item: its name, a
 * 0–100% slider and the % readout, plus any cells the caller adds at the
 * end (the generator's compass, a remove button). The
 * sliders always add up to 100%: moving one shares the rest among the
 * others in the proportions they had when the drag started
 * (src/ui/shares.ts). Arrow keys move a slider by 1% (the browser's own
 * range keys); scrolling over one nudges it by 5%.
 *
 * Events: `onInput` on every step (live previews; throttle there),
 * `onChange` once the gesture ends (letting go, a key press, the wheel
 * settling): save or remake there.
 *
 * Used by: the generator page (map influence / blend), Edit region › Mix
 * biomes, Blend into <biome>. Any new "shares of a whole" input must use
 * it too (the standard, UI consistency audit 2026-10-12).
 */

import { wheelValue } from "../worldgen/scrub";
import { shareText, ShareState, type EmptyOthers } from "./shares";

export interface ShareItem {
  label: string;
  /** Hover text for the name (default: the label). */
  title?: string;
  /** A colour swatch before the name (biomes). */
  color?: string;
  /** Extra class on the row (e.g. "is-missing"). */
  cls?: string;
}

export interface ShareSlidersOptions {
  items: readonly ShareItem[];
  /** Starting weights, any scale (shown as shares of their total). */
  weights: readonly number[];
  /** What moving one does when the others are all 0 (see EmptyOthers). Default "split". */
  empty?: EmptyOthers;
  /** The slider's accessible name (default "<label> share"). */
  ariaLabel?: (item: ShareItem) => string;
  /** Column headings, one per cell (name, share, then the caller's). */
  head?: readonly string[];
  /** Add the row's trailing cells. */
  extra?: (row: HTMLElement, index: number) => void;
  /** Every step: shares (floats adding up to 100) and the whole percentages shown. */
  onInput?: (shares: number[], percents: number[]) => void;
  /** Once a gesture ends. */
  onChange?: (shares: number[], percents: number[]) => void;
  /** Extra class on the box. */
  cls?: string;
}

export interface ShareSliders {
  el: HTMLElement;
  /** Shares now (floats adding up to 100). */
  shares(): number[];
  /** Whole percentages now (as shown). */
  percents(): number[];
  setDisabled(disabled: boolean): void;
}

/** Wheel: one notch moves a slider this many %. */
const WHEEL_STEP = 5;
/** Quiet time after the last wheel notch before onChange (one save or remake per burst). */
const WHEEL_SETTLE_MS = 500;

export function renderShareSliders(parent: HTMLElement, opts: ShareSlidersOptions): ShareSliders {
  const state = new ShareState(opts.weights, opts.empty ?? "split");
  const el = parent.createDiv({ cls: "duckmage-share-sliders" + (opts.cls ? ` ${opts.cls}` : "") });
  if (opts.head) {
    const head = el.createDiv({ cls: "duckmage-share-sliders-row is-head" });
    for (const h of opts.head) head.createSpan({ text: h });
  }
  const single = opts.items.length === 1;
  const rows = opts.items.map((item, i) => {
    const row = el.createDiv({ cls: "duckmage-share-sliders-row" + (item.cls ? ` ${item.cls}` : "") });
    const name = row.createSpan({ cls: "duckmage-share-sliders-name", attr: { title: item.title ?? item.label } });
    if (item.color) name.createSpan({ cls: "duckmage-biome-swatch" }).setCssProps({ "--duckmage-biome-color": item.color });
    name.createSpan({ text: item.label });
    const slider = row.createEl("input", {
      type: "range",
      attr: { min: "0", max: "100", step: "1", "aria-label": opts.ariaLabel ? opts.ariaLabel(item) : `${item.label} share` },
    });
    const value = row.createSpan({ cls: "duckmage-share-sliders-value" });
    opts.extra?.(row, i);
    return { slider, value };
  });

  const show = () => {
    const shares = state.values();
    const whole = state.percents();
    rows.forEach((r, i) => {
      r.slider.value = String(whole[i]);
      r.value.setText(shareText(shares[i], whole[i]));
      r.slider.setAttr("aria-valuetext", shareText(shares[i], whole[i]));
    });
  };
  const fire = (cb?: (s: number[], p: number[]) => void) => cb?.(state.values(), state.percents());
  show();

  let wheelTimer: number | null = null;
  rows.forEach((r, i) => {
    if (single) r.slider.disabled = true;
    r.slider.addEventListener("input", () => {
      state.set(i, Number(r.slider.value));
      show();
      fire(opts.onInput);
    });
    r.slider.addEventListener("change", () => {
      state.settle();
      show();
      fire(opts.onChange);
    });
    // Scroll to nudge by 5%; onChange once the wheel stops.
    r.slider.addEventListener("wheel", (e: WheelEvent) => {
      if (r.slider.disabled) return;
      e.preventDefault();
      state.set(i, wheelValue(state.percents()[i], e.deltaY, { min: 0, max: 100, step: WHEEL_STEP }));
      show();
      fire(opts.onInput);
      const win = r.slider.ownerDocument.defaultView ?? activeWindow;
      if (wheelTimer !== null) win.clearTimeout(wheelTimer);
      wheelTimer = win.setTimeout(() => {
        wheelTimer = null;
        state.settle();
        fire(opts.onChange);
      }, WHEEL_SETTLE_MS);
    }, { passive: false });
  });

  return {
    el,
    shares: () => state.values(),
    percents: () => state.percents(),
    setDisabled: (disabled: boolean) => rows.forEach((r) => (r.slider.disabled = disabled || single)),
  };
}
