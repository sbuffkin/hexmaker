/**
 * The shared single-value slider kit (UI consistency audit 2026-10-12,
 * standards 3, 5, 6 and 7; owner: "the same kind of input uses the same
 * shared control everywhere"):
 *
 * - `renderLabeledSlider`: label, slider, the value ALWAYS shown (one
 *   formatter per kind of value), an optional help line and reset, the
 *   mouse wheel, and (per src/ui/numberBoxes.ts) a typed number box.
 *   Previews on input, writes on change.
 * - `renderMultiplierSlider`: a bias on a default or learned amount, ×0–3
 *   in quarter steps, "×N", where ×1 means "not set".
 * - `renderResetButton`: the one reset-to-default button (rotate icon).
 * - An optional or inherited value (`isSet`): shown dimmed while unset,
 *   with the reset; callers count it toward "· N set" (Disclosure.place).
 *
 * Shares of a whole use ShareSliders (src/ui/shareSliders.ts) instead.
 * tests/uiConsistency.test.ts fails on a range input built anywhere else.
 */

import { setIcon } from "obsidian";
import { wheelValue } from "./scrub";
import { numberBoxShown } from "./numberBoxes";

// ── value formatters (audit S2: one per kind of value) ─────────────────────

/** Up to two decimals, no trailing zeros. */
export const trimNumber = (v: number): string => String(Math.round(v * 100) / 100);

export const sliderFormat = {
  /** A value already in percent (0–100): "40%". */
  percent: (v: number): string => `${Math.round(v)}%`,
  /** A 0–1 strength shown as a percent: 0.25 → "25%". */
  fraction: (v: number): string => `${Math.round(v * 100)}%`,
  /** A multiplier: "×1.25". */
  multiplier: (v: number): string => `×${trimNumber(v)}`,
  /** A count: "3". */
  count: (v: number): string => String(Math.round(v)),
  /** Pixels: "4 px". */
  px: (v: number): string => `${trimNumber(v)} px`,
  /** Any other number: "0.35". */
  plain: (v: number): string => trimNumber(v),
} as const;

export type SliderFormat = (v: number) => string;

// ── reset ──────────────────────────────────────────────────────────────────

export interface ResetButton {
  el: HTMLButtonElement;
  /** Enable it when the value is set (not at its default). */
  sync(isSet: boolean): void;
}

/**
 * The one reset-to-default button: a rotate icon, "Reset <what> to default
 * (<value>)", disabled while already at the default.
 */
export function renderResetButton(parent: HTMLElement, opts: { what: string; defaultText: string; onReset: () => void; title?: string }): ResetButton {
  const label = `Reset ${opts.what} to default (${opts.defaultText})`;
  const el = parent.createEl("button", { cls: "clickable-icon duckmage-reset-btn", attr: { "aria-label": label, title: opts.title ?? label } });
  setIcon(el, "rotate-ccw");
  el.addEventListener("click", () => {
    if (!el.disabled) opts.onReset();
  });
  return {
    el,
    sync: (isSet: boolean) => {
      el.disabled = !isSet;
    },
  };
}

// ── labelled slider ────────────────────────────────────────────────────────

export interface LabeledSliderOptions {
  /** Shown label; "" for a slider in a table cell (give `ariaLabel`). */
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** How the value reads (default: plain). */
  format?: SliderFormat;
  ariaLabel?: string;
  /** Hover text on the label. */
  title?: string;
  /** A help line under the slider. */
  help?: string;
  /** Extra class on the row. */
  cls?: string;
  /** "row" (label, slider, value on one line; default) or "stacked" (label and value over a full-width slider). */
  layout?: "row" | "stacked";
  /** Wheel step (default: `step`). */
  wheelStep?: number;
  /**
   * A reset to `value` (the default or inherited value), with its text
   * ("×1", "50%"; default: the formatted value). The reset fires `onReset`
   * if given, else onInput + onChange with the value.
   */
  reset?: { value: number; text?: string; onReset?: () => void };
  /**
   * An optional / inherited value: whether it's set. While unset the row
   * is dimmed (it shows the inherited value) and the reset is disabled.
   * Default: set when the value differs from `reset.value`.
   */
  isSet?: () => boolean;
  /** Every step (live previews; the readout is already updated). */
  onInput?: (value: number) => void;
  /** Once the gesture ends: save or remake here. */
  onChange?: (value: number) => void;
}

export interface LabeledSlider {
  el: HTMLElement;
  input: HTMLInputElement;
  value(): number;
  /** Show a value (no events). */
  set(value: number): void;
  setDisabled(disabled: boolean): void;
  /** Re-read `isSet` (after an outside change). */
  refresh(): void;
}

/** Quiet time after the last wheel notch before onChange (one save per burst). */
const WHEEL_SETTLE_MS = 400;

/** Snap to the slider's step and range. */
function snap(v: number, min: number, max: number, step: number): number {
  const s = Math.round((v - min) / step) * step + min;
  return Math.max(min, Math.min(max, Math.round(s * 1e6) / 1e6));
}

export function renderLabeledSlider(parent: HTMLElement, opts: LabeledSliderOptions): LabeledSlider {
  const format = opts.format ?? sliderFormat.plain;
  const stacked = opts.layout === "stacked";
  const el = parent.createDiv({ cls: "duckmage-labeled-slider" + (stacked ? " is-stacked" : "") + (opts.cls ? ` ${opts.cls}` : "") });
  const aria = opts.ariaLabel ?? opts.label;
  const range = (p: HTMLElement) =>
    p.createEl("input", { type: "range", attr: { min: String(opts.min), max: String(opts.max), step: String(opts.step), "aria-label": aria } });
  // Row: label, slider, value, [box], [reset]. Stacked: the same head over a full-width slider.
  const head = stacked ? el.createDiv({ cls: "duckmage-labeled-slider-head" }) : el;
  if (opts.label) head.createSpan({ cls: "duckmage-labeled-slider-label", text: opts.label, attr: opts.title ? { title: opts.title } : {} });
  else if (opts.title) el.setAttr("title", opts.title);
  const inline = stacked ? null : range(el);
  const shown = head.createSpan({ cls: "duckmage-labeled-slider-value" });
  const box = numberBoxShown()
    ? head.createEl("input", {
      type: "number",
      cls: "duckmage-wfc-num duckmage-labeled-slider-box",
      attr: { min: String(opts.min), max: String(opts.max), step: String(opts.step), "aria-label": `${aria} value` },
    })
    : null;
  let current = snap(opts.value, opts.min, opts.max, opts.step);
  let show = () => {};
  const reset = opts.reset
    ? renderResetButton(head, {
      what: aria.toLowerCase(),
      defaultText: opts.reset.text ?? format(opts.reset.value),
      onReset: () => {
        const r = opts.reset!;
        current = r.value;
        if (r.onReset) r.onReset();
        else {
          opts.onInput?.(current);
          opts.onChange?.(current);
        }
        show();
      },
    })
    : null;
  const slider = inline ?? range(el);
  if (opts.help) el.createDiv({ cls: "setting-item-description duckmage-labeled-slider-help", text: opts.help });

  const isSet = opts.isSet ?? (() => (opts.reset ? current !== opts.reset.value : true));
  show = () => {
    slider.value = String(current);
    shown.setText(format(current));
    slider.setAttr("aria-valuetext", format(current));
    if (box) box.value = String(current);
    const set = isSet();
    el.toggleClass("is-inherited", !!(opts.reset || opts.isSet) && !set);
    reset?.sync(set);
  };
  show();

  // The readout first, then the caller, then the set / inherited look (the caller may have just set it).
  slider.addEventListener("input", () => {
    current = Number(slider.value);
    show();
    opts.onInput?.(current);
    show();
  });
  slider.addEventListener("change", () => {
    current = Number(slider.value);
    show();
    opts.onChange?.(current);
    show();
  });
  box?.addEventListener("change", () => {
    const n = Number(box.value);
    current = Number.isFinite(n) && box.value.trim() !== "" ? snap(n, opts.min, opts.max, opts.step) : current;
    show();
    opts.onInput?.(current);
    opts.onChange?.(current);
    show();
  });
  // Scroll over the slider: one wheel step per notch, onChange once it settles.
  let wheelTimer: number | null = null;
  slider.addEventListener("wheel", (e: WheelEvent) => {
    if (slider.disabled) return;
    e.preventDefault();
    const next = wheelValue(current, e.deltaY, { min: opts.min, max: opts.max, step: opts.wheelStep ?? opts.step });
    if (next === current) return;
    current = snap(next, opts.min, opts.max, opts.step);
    show();
    opts.onInput?.(current);
    show();
    const win = slider.ownerDocument.defaultView ?? activeWindow;
    if (wheelTimer !== null) win.clearTimeout(wheelTimer);
    wheelTimer = win.setTimeout(() => {
      wheelTimer = null;
      opts.onChange?.(current);
    }, WHEEL_SETTLE_MS);
  }, { passive: false });

  return {
    el,
    input: slider,
    value: () => current,
    set: (v: number) => {
      current = snap(v, opts.min, opts.max, opts.step);
      show();
    },
    setDisabled: (d: boolean) => {
      slider.disabled = d;
      if (box) box.disabled = d;
      el.toggleClass("is-disabled", d);
    },
    refresh: () => show(),
  };
}

// ── multiplier ─────────────────────────────────────────────────────────────

export interface MultiplierSliderOptions {
  label: string;
  /** The stored multiplier, or undefined for ×1 (not set). */
  value: number | undefined;
  ariaLabel?: string;
  title?: string;
  help?: string;
  cls?: string;
  /** Highest multiplier (default 3). */
  max?: number;
  /** Every step: the multiplier, undefined at ×1. */
  onInput?: (value: number | undefined) => void;
  /** Once the gesture ends (or reset): the multiplier, undefined at ×1. */
  onChange?: (value: number | undefined) => void;
}

/** ×1 is "not set": stored as nothing. */
export const multiplierValue = (v: number): number | undefined => (v === 1 ? undefined : v);

/**
 * A bias on a default or learned amount (generator Bias, path knobs, biome
 * pool weights): ×0–3 in quarter steps, "×N", ×1 = not set, with a reset to
 * ×1. Writes `undefined` at ×1.
 */
export function renderMultiplierSlider(parent: HTMLElement, opts: MultiplierSliderOptions): LabeledSlider {
  return renderLabeledSlider(parent, {
    label: opts.label,
    ariaLabel: opts.ariaLabel,
    title: opts.title,
    help: opts.help,
    cls: "duckmage-multiplier-slider" + (opts.cls ? ` ${opts.cls}` : ""),
    min: 0,
    max: opts.max ?? 3,
    step: 0.25,
    value: opts.value ?? 1,
    format: sliderFormat.multiplier,
    reset: { value: 1 },
    onInput: (v) => opts.onInput?.(multiplierValue(v)),
    onChange: (v) => opts.onChange?.(multiplierValue(v)),
  });
}
