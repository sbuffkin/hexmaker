import { describe, it } from "node:test";
import expect from "expect";
import { readFileSync } from "node:fs";
import { percentsToWeights, rebalanceShares, shareText, toPercents, toShares, ShareState } from "../src/ui/shares";
import { renderShareSliders } from "../src/ui/shareSliders";
import { rebalance } from "../src/worldgen/regionWeights";
import { comboId, comboParts, formatComboRef, mixToParts, newPartWeight, parseComboRef, type BiomePart } from "../src/overworld/biomeCombo";
import { readSurface, readSource } from "./helpers/source";

/**
 * The shared zero-sum sliders (owner 2026-10-12: "when mixing the weights
 * should be zero sum sliders like in the generator tab, make sure that we
 * keep consistent UX for things like this in the future").
 */

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("zero-sum shares", () => {
  it("the sum stays 100 whatever is moved, for any starting set", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
      const n = 1 + Math.floor(rnd() * 6);
      const start = toShares(Array.from({ length: n }, () => (rnd() < 0.2 ? 0 : rnd() * 50)));
      const out = rebalanceShares(start, Math.floor(rnd() * n), rnd() * 120 - 10);
      expect(sum(out)).toBeCloseTo(100, 6);
      expect(sum(toPercents(out))).toBe(100);
      for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("dragging one rebalances the others in proportion", () => {
    close(rebalanceShares([50, 30, 20], 0, 80), [80, 12, 8]);
    close(rebalanceShares([25, 25, 50], 2, 0), [50, 50, 0]);
    close(rebalanceShares([10, 20, 30, 40], 3, 70), [5, 10, 15, 70]);
  });

  it("edges: 0 and 100, clamped; the others all 0 split or hold", () => {
    close(rebalanceShares([40, 60], 0, 100), [100, 0]);
    close(rebalanceShares([40, 60], 0, 0), [0, 100]);
    close(rebalanceShares([40, 60], 0, 140), [100, 0]);
    close(rebalanceShares([40, 60], 0, -5), [0, 100]);
    close(rebalanceShares([100, 0, 0], 0, 40, "split"), [40, 30, 30]);
    // "hold": 0 means not in it, so the only one in it stays at 100 until another is raised.
    close(rebalanceShares([100, 0, 0], 0, 40, "hold"), [100, 0, 0]);
    close(rebalanceShares([100, 0, 0], 1, 30, "hold"), [70, 30, 0]);
    close(rebalanceShares([0, 0, 0], 2, 30, "hold"), [0, 0, 100]);
  });

  it("a single item is always 100%; none is empty", () => {
    expect(rebalanceShares([100], 0, 30)).toEqual([100]);
    expect(rebalanceShares([], 0, 30)).toEqual([]);
    expect(new ShareState([3]).percents()).toEqual([100]);
  });

  it("weights of any scale start as their shares; all 0 splits or holds", () => {
    close(toShares([2, 1, 1]), [50, 25, 25]);
    close(toShares([0, 0]), [50, 50]);
    expect(toShares([0, 0], "hold")).toEqual([0, 0]);
    expect(new ShareState([0, 0, 0], "hold").percents()).toEqual([0, 0, 0]);
  });

  it("a drag rebalances from where it started: to 100 and back gives the others their split again", () => {
    const s = new ShareState([20, 30, 50]);
    s.set(0, 100);
    expect(s.percents()).toEqual([100, 0, 0]);
    s.set(0, 20);
    expect(s.percents()).toEqual([20, 30, 50]);
    s.settle();
    s.set(1, 0);
    expect(s.percents()).toEqual([29, 0, 71]);
  });

  it("readouts are whole percentages adding up to 100; a sliver shows <1%", () => {
    expect(new ShareState([1, 1, 1]).percents()).toEqual([34, 33, 33]);
    expect(shareText(0.3, 0)).toBe("<1%");
    expect(shareText(0, 0)).toBe("0%");
    expect(shareText(33.4, 33)).toBe("33%");
  });

});

describe("generator page parity", () => {
  /** The generator's own rebalance before the shared control (src/worldgen/regionWeights.ts at e8103fb). */
  function oldRebalance(weights: number[], index: number, value: number): number[] {
    const n = weights.length;
    if (n <= 1) return n ? [100] : [];
    const v = Math.max(0, Math.min(100, Math.round(value)));
    const others = weights.map((w, i) => (i === index ? 0 : Math.max(0, w)));
    const othersSum = others.reduce((s, w) => s + w, 0);
    const share = toPercents(othersSum > 0 ? others : weights.map((_, i) => (i === index ? 0 : 1)), 100 - v);
    return share.map((w, i) => (i === index ? v : w));
  }

  it("one step from a stored influence lands where the generator's own sliders did", () => {
    const sets = [[50, 30, 20], [60, 40], [100, 0, 0], [34, 33, 33], [10, 20, 30, 40], [70, 30], [1, 99], [0, 100]];
    for (const w of sets) for (let i = 0; i < w.length; i++) for (const v of [0, 1, 5, 33, 50, 67, 99, 100]) {
      const want = oldRebalance(w, i, v);
      expect({ w, i, v, got: rebalance(w, i, v) }).toEqual({ w, i, v, got: want });
      // The shared control's first step matches too (whole percentages either way).
      const s = new ShareState(w);
      s.set(i, v);
      expect(sum(s.percents())).toBe(100);
      expect(s.percents()[i]).toBe(v);
      s.percents().forEach((p, j) => expect(Math.abs(p - want[j])).toBeLessThanOrEqual(1));
    }
  });

  it("the generator page, Edit region's Mix biomes and Blend into all use the shared control", () => {
    const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
    for (const p of ["worldgen/GeneratorPanel.ts", "overworld/EditRegionModal.ts", "overworld/BlendIntoBiomeModal.ts"]) {
      expect({ p, uses: readSource("src", p).includes("renderShareSliders(") }).toEqual({ p, uses: true });
    }
    // No one-off influence / weight sliders left behind.
    expect(readSurface("generator-page")).not.toContain("influence-row");
    expect(src("overworld/EditRegionModal.ts")).not.toContain("mix-weight");
  });
});

describe("Mix biomes storage", () => {
  const ids: Record<string, string> = { alpine: "Alpine", taiga: "Taiga", swamp: "Swamp" };
  const resolve = (name: string) => Object.keys(ids).find((k) => k === name.toLowerCase() || ids[k].toLowerCase() === name.toLowerCase());
  const label = (id: string) => ids[id] ?? id;

  it("slider percentages become small whole weights that read back the same", () => {
    expect(percentsToWeights([67, 33])).toEqual([2, 1]);
    expect(percentsToWeights([50, 50])).toEqual([1, 1]);
    expect(percentsToWeights([70, 30])).toEqual([7, 3]);
    expect(percentsToWeights([34, 33, 33])).toEqual([1, 1, 1]);
    expect(percentsToWeights([60, 25, 15])).toEqual([12, 5, 3]);
    expect(percentsToWeights([100, 0])).toEqual([1, 0]);
    for (const p of [[68, 32], [51, 49], [13, 87], [1, 99], [45, 22, 33]]) expect(toPercents(percentsToWeights(p))).toEqual(p);
  });

  it("round trip: an old note's mix reads, shows as shares and writes back unchanged", () => {
    for (const written of ["Alpine 2 + Taiga 1", "Alpine + Taiga", "Alpine 3 + Taiga 2 + Swamp 1", "[[Alpine]] ×2, [[Taiga]]"]) {
      const parts = parseComboRef(written, resolve)!;
      const state = new ShareState(parts.map((p) => p.weight));
      const back = mixToParts(parts.map((p, i) => ({ id: p.id, weight: state.values()[i] })));
      expect(comboId(back)).toBe(comboId(parts));
    }
    expect(formatComboRef(mixToParts([{ id: "alpine", weight: 66.6 }, { id: "taiga", weight: 33.4 }]), label)).toBe("Alpine 2 + Taiga 1");
    expect(formatComboRef(mixToParts([{ id: "alpine", weight: 50 }, { id: "taiga", weight: 50 }]), label)).toBe("Alpine + Taiga");
  });

  it("weights that aren't whole are kept as written while the sliders still show them", () => {
    const stored = comboParts("alpine*1.5+taiga");
    const shown = new ShareState(stored.map((p) => p.weight)).values();
    expect(mixToParts(stored.map((p, i) => ({ id: p.id, weight: shown[i] })), stored)).toEqual(stored);
  });

  it("a slider at 0% leaves that biome out; one left is that biome alone", () => {
    const parts: BiomePart[] = [{ id: "alpine", weight: 100 }, { id: "taiga", weight: 0 }];
    expect(comboId(mixToParts(parts))).toBe("alpine");
  });

  it("a biome added to a mix gets an equal share", () => {
    const mix: BiomePart[] = [{ id: "alpine", weight: 67 }, { id: "taiga", weight: 33 }];
    mix.push({ id: "swamp", weight: newPartWeight(mix) });
    expect(new ShareState(mix.map((p) => p.weight)).percents()).toEqual([45, 22, 33]);
    expect(newPartWeight([])).toBe(1);
  });
});

// ── the DOM control, on a tiny fake DOM ────────────────────────────────────

class FakeEl {
  children: FakeEl[] = [];
  text = "";
  cls: string;
  attrs: Record<string, string> = {};
  value = "";
  disabled = false;
  listeners = new Map<string, ((e: unknown) => void)[]>();
  ownerDocument = { defaultView: { setTimeout: (f: () => void) => { f(); return 1; }, clearTimeout: () => {} } };
  constructor(public tag: string, o: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
    this.cls = o.cls ?? "";
    this.text = o.text ?? "";
    Object.assign(this.attrs, o.attr ?? {});
    if (o.type) this.attrs.type = o.type;
  }
  createEl(tag: string, o: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}): FakeEl {
    const c = new FakeEl(tag, o);
    this.children.push(c);
    return c;
  }
  createDiv(o = {}) { return this.createEl("div", o); }
  createSpan(o = {}) { return this.createEl("span", o); }
  setText(t: string) { this.text = t; }
  setAttr(k: string, v: string) { this.attrs[k] = v; }
  setCssProps() {}
  addEventListener(type: string, f: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
  fire(type: string, e: unknown = {}) { for (const f of this.listeners.get(type) ?? []) f(e); }
  all(pred: (e: FakeEl) => boolean): FakeEl[] { return [...this.children.filter(pred), ...this.children.flatMap((c) => c.all(pred))]; }
}

describe("renderShareSliders", () => {
  const make = (weights: number[], extra?: (row: FakeEl, i: number) => void) => {
    const root = new FakeEl("div");
    const inputs: number[][] = [], changes: number[][] = [];
    const ui = renderShareSliders(root as unknown as HTMLElement, {
      items: weights.map((_, i) => ({ label: `Item ${i}` })),
      weights,
      extra: extra as never,
      onInput: (_s, p) => inputs.push(p),
      onChange: (_s, p) => changes.push(p),
    });
    const sliders = root.all((e) => e.attrs.type === "range");
    const readouts = root.all((e) => e.cls === "duckmage-share-sliders-value");
    return { root, ui, sliders, readouts, inputs, changes };
  };

  it("one row per item: slider and readout, with the caller's cells at the end", () => {
    const { sliders, readouts, root } = make([2, 1, 1], (row) => row.createEl("button", { text: "×" }));
    expect(sliders.map((s) => s.value)).toEqual(["50", "25", "25"]);
    expect(readouts.map((r) => r.text)).toEqual(["50%", "25%", "25%"]);
    expect(sliders[0].attrs["aria-label"]).toBe("Item 0 share");
    expect(root.all((e) => e.tag === "button")).toHaveLength(3);
  });

  it("dragging updates every readout live and reports once on release", () => {
    const { sliders, readouts, inputs, changes } = make([50, 30, 20]);
    sliders[0].value = "80";
    sliders[0].fire("input");
    expect(readouts.map((r) => r.text)).toEqual(["80%", "12%", "8%"]);
    expect(sliders.map((s) => s.value)).toEqual(["80", "12", "8"]);
    expect(inputs).toEqual([[80, 12, 8]]);
    expect(changes).toEqual([]);
    sliders[0].fire("change");
    expect(changes).toEqual([[80, 12, 8]]);
  });

  it("the wheel nudges by 5% and settles into one change", () => {
    const { sliders, changes } = make([50, 50]);
    sliders[1].fire("wheel", { deltaY: -1, preventDefault: () => {} });
    expect(sliders.map((s) => s.value)).toEqual(["45", "55"]);
    expect(changes).toEqual([[45, 55]]);
  });

  it("a single item is fixed at 100% (its slider is disabled)", () => {
    const { sliders, readouts, ui } = make([4]);
    expect(readouts[0].text).toBe("100%");
    expect(sliders[0].disabled).toBe(true);
    ui.setDisabled(false);
    expect(sliders[0].disabled).toBe(true);
  });
});
