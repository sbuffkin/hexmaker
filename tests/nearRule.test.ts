import { describe, it } from "node:test";
import expect from "expect";
import { fakeRoot, type FakeEl } from "./helpers/fakeDom";
import { renderNearRow } from "../src/worldgen/genPage/terrainMix";
import type { NearRule } from "../packages/hex-wfc/src";

/**
 * The generator page's Near rule (src/worldgen/genPage/terrainMix.ts): a
 * select of the terrains on the map plus a distance box, replacing the
 * free-text "volcano 3" field.
 */

function row(learned: NearRule | undefined, current: NearRule | null | undefined, onMap = ["volcano", "hills", "ash"]) {
  const { root, el } = fakeRoot();
  const changes: (NearRule | null | undefined)[] = [];
  renderNearRow(el, "lava", learned, current, onMap, (r) => changes.push(r));
  const select = root.all((e) => e.tag === "select")[0];
  const distance = root.inputs("number")[0];
  const options = (s: FakeEl) => s.all((e) => e.tag === "option").map((o) => o.text);
  return { select, distance, changes, options: () => options(select) };
}

describe("near rule: terrain select and distance", () => {
  it("offers as learned, off, then only the terrains on the map, sorted", () => {
    const r = row({ terrain: "volcano", distance: 3 }, undefined);
    expect(r.options()).toEqual(["As learned (volcano, 3)", "Off", "ash", "hills", "volcano"]);
    expect(r.select.value).toBe("");
    // As learned: the generator's distance is shown, not editable.
    expect(r.distance.value).toBe("3");
    expect(r.distance.disabled).toBe(true);
  });

  it("picking a terrain sets a rule, keeping the learned distance", () => {
    const r = row({ terrain: "volcano", distance: 3 }, undefined);
    r.select.value = "ash";
    r.select.fire("change");
    expect(r.changes).toEqual([{ terrain: "ash", distance: 3 }]);
    expect(r.distance.disabled).toBe(false);
  });

  it("with nothing learned, a new rule starts at 2 hexes", () => {
    const r = row(undefined, undefined);
    expect(r.options()[0]).toBe("As learned (none)");
    expect(r.distance.value).toBe("");
    r.select.value = "hills";
    r.select.fire("change");
    expect(r.changes).toEqual([{ terrain: "hills", distance: 2 }]);
  });

  it("the distance is a number, clamped to 1–50", () => {
    const r = row(undefined, { terrain: "volcano", distance: 3 });
    expect(r.select.value).toBe("volcano");
    for (const [typed, want] of [["5", 5], ["0", 1], ["99", 50], ["2.6", 3]] as const) {
      r.distance.value = typed;
      r.distance.fire("change");
      expect(r.changes.at(-1)).toEqual({ terrain: "volcano", distance: want });
    }
    // Cleared: keeps the last distance rather than dropping the rule.
    r.distance.value = "";
    r.distance.fire("change");
    expect(r.changes.at(-1)).toEqual({ terrain: "volcano", distance: 3 });
    expect(r.distance.value).toBe("3");
  });

  it("off and back to as learned", () => {
    const r = row({ terrain: "volcano", distance: 3 }, { terrain: "ash", distance: 1 });
    r.select.value = "\u0000off";
    r.select.fire("change");
    expect(r.changes.at(-1)).toBeNull();
    expect(r.distance.disabled).toBe(true);
    r.select.value = "";
    r.select.fire("change");
    expect(r.changes.at(-1)).toBeUndefined();
    expect(r.distance.value).toBe("3");
  });

  it("a rule on a terrain taken out of the mix stays choosable, marked", () => {
    const r = row(undefined, { terrain: "obsidian", distance: 2 }, ["volcano"]);
    expect(r.options()).toEqual(["As learned (none)", "Off", "volcano", "obsidian (not in the mix)"]);
    expect(r.select.value).toBe("obsidian");
  });
});
