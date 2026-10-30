/**
 * P4 (owner 2026-10-16): names sit above the hex numbers, and every kind
 * of name has its own toggle in the layers menu.
 */
import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { FakeEl, fakeRoot } from "./helpers/fakeDom";
import { OverlayPanel } from "../src/hex-map/HexSidePanel";
import { buildMapNote, parseMapNote } from "../src/maps/mapNote";
import { DEFAULT_SETTINGS } from "../src/constants";
import type { MapData } from "../src/types";

/** The z-index the last rule with exactly this selector gives (CSS: later wins at equal specificity). */
function zOf(css: string, selector: string): string | undefined {
  let z: string | undefined;
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(css); m; m = rule.exec(css)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!sels.includes(selector)) continue;
    const v = /z-index:\s*([^;]+);/.exec(m[2]);
    if (v) z = v[1].trim();
  }
  return z;
}

describe("map labels: names above the hex numbers (P4)", () => {
  const css = readFileSync("styles.css", "utf8");
  const n = (sel: string) => Number(zOf(css, sel));
  const coords = Math.max(n(".duckmage-coord-labels-layer"), n(".duckmage-hex-map-grid > .duckmage-coord-labels-layer"));

  it("hex, token and area names stack above the coordinates", () => {
    expect(coords).toBeGreaterThan(0);
    for (const sel of [".duckmage-hex-names-layer", ".duckmage-token-layer > .duckmage-token-name", ".duckmage-region-labels-layer"]) {
      expect(n(sel)).toBeGreaterThan(coords);
    }
  });

  it("tokens stay under the coordinates; the token layer doesn't trap its names below them", () => {
    // A z-indexed token layer would be a stacking context: its names could never rise above the coordinates.
    expect(zOf(css, ".duckmage-token-layer")).toBe("auto");
    expect(n(":where(.duckmage-token-layer > .duckmage-token)")).toBeLessThan(coords);
    // Zero specificity, so hover and drag still lift a token.
    expect(n(".duckmage-token:hover")).toBeGreaterThan(coords);
    expect(n(".duckmage-token-dragging")).toBeGreaterThan(coords);
  });

  it("link badges stay above the names (round 6 R1)", () => {
    expect(n(".duckmage-link-badges-layer")).toBeGreaterThan(n(".duckmage-hex-names-layer"));
  });

  it("each kind of name hides with its own class", () => {
    expect(css).toMatch(/\.duckmage-hide-hex-names \.duckmage-hex-names-layer \{ display: none; \}/);
    expect(css).toMatch(/\.duckmage-hide-token-names \.duckmage-token-name \{ display: none; \}/);
    expect(css).toMatch(/\.duckmage-hide-area-names \.duckmage-region-labels-layer \{ display: none; \}/);
  });
});

// ── The layers menu ────────────────────────────────────────────────────────

/** The bits of HTMLElement the panel uses beyond the shared fake. */
function patchFakeEl(): void {
  const p = FakeEl.prototype as unknown as Record<string, unknown>;
  if (p.__patched) return;
  Object.defineProperty(p, "style", { get() { return (this.__style ??= {}); } });
  Object.assign(p, {
    __patched: true,
    hide(this: FakeEl & { shown?: boolean }) { this.shown = false; },
    show(this: FakeEl & { shown?: boolean }) { this.shown = true; },
    isShown(this: FakeEl & { shown?: boolean }) { return this.shown !== false; },
    toggle(this: FakeEl & { shown?: boolean }, on: boolean) { this.shown = on; },
    remove() {},
    insertBefore(this: FakeEl, el: FakeEl) { el.parent = this; this.children.push(el); },
    appendChild(this: FakeEl, el: FakeEl) { el.parent = this; this.children.push(el); return el; },
    setAttr(this: FakeEl, k: string, v: string) { this.attrs[k] = v; },
  });
}

function layersMenu(map: Partial<MapData>) {
  patchFakeEl();
  const { root, el } = fakeRoot();
  const viewport = new FakeEl("div");
  let saves = 0;
  const plugin = {
    app: { loadLocalStorage: () => null, saveLocalStorage: () => {} },
    settings: { ...DEFAULT_SETTINGS, maps: [] },
    saveSettings: async () => { saves++; },
    sectionWordsFor: () => (s: string) => ({ label: s }),
  };
  const noop = () => {};
  const panel = new OverlayPanel(el, plugin as never, () => viewport as unknown as HTMLElement, () => map as MapData, noop, noop, noop, noop);
  panel.syncToRegion();
  return { root, viewport, panel, saves: () => saves };
}

/** A checkbox in the fake DOM (the panel sets `checked` on it). */
const box = (e: FakeEl | undefined) => e as unknown as { checked: boolean; fire(t: string): void } | undefined;

describe("layers menu: a toggle per kind of name (P4)", () => {
  it("Labels has Hex names, Token names and Area names, on by default", () => {
    const { root } = layersMenu({});
    const labels = root.all((e) => e.classes.has("duckmage-overlay-label-toggle"));
    const byName = new Map(labels.map((row) => [row.find("duckmage-overlay-label")!.text, box(row.inputs("checkbox")[0])]));
    for (const name of ["Coordinates", "Hex names", "Token names", "Area names"]) {
      expect(byName.get(name)?.checked).toBe(true);
    }
  });

  it("turning Area names off hides them on the map and keeps the choice per map", () => {
    const map: Partial<MapData> = {};
    const { root, viewport, saves } = layersMenu(map);
    const row = root.all((e) => e.classes.has("duckmage-overlay-label-toggle")).find((r) => r.find("duckmage-overlay-label")!.text === "Area names")!;
    const cb = box(row.inputs("checkbox")[0])!;
    cb.checked = false;
    cb.fire("change");
    expect(map.showAreaNames).toBe(false);
    expect(saves()).toBe(1);
    expect(viewport.hasClass("duckmage-hide-area-names")).toBe(true);
    cb.checked = true;
    cb.fire("change");
    expect(viewport.hasClass("duckmage-hide-area-names")).toBe(false);
  });

  it("a map saved with area names off opens with them off", () => {
    const { viewport } = layersMenu({ showAreaNames: false });
    expect(viewport.hasClass("duckmage-hide-area-names")).toBe(true);
  });

  it("the map note keeps it (show-area-names); older notes without it show the names", () => {
    const note = buildMapNote("m", { settings: { gridSize: { cols: 2, rows: 2 }, gridOffset: { x: 0, y: 0 }, showAreaNames: false } as never, hexes: new Map(), paths: [] });
    expect(note).toContain("show-area-names: false");
    expect(parseMapNote(note)!.settings.showAreaNames).toBe(false);
    const old = buildMapNote("m", { settings: { gridSize: { cols: 2, rows: 2 }, gridOffset: { x: 0, y: 0 } } as never, hexes: new Map(), paths: [] });
    expect(old).not.toContain("show-area-names");
    expect(parseMapNote(old)!.settings.showAreaNames).toBeUndefined();
  });
});
