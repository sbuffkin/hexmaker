import expect from "expect";
import { it } from "node:test";
import { FogService } from "../src/fog/FogService";
import { setFog } from "../src/fog/context";
import { registry } from "../src/modules";
import { moduleFog, modulePartyClick, modulePartyControls } from "../src/modules/runtime";
import { ACTION_POLICY, MENU_ACTIONS } from "../src/workMode";
import { readMapNote, updateMapNote } from "../src/maps/mapNote";
import { describeWith, describeWithout } from "./helpers/slices";

/**
 * Fog of war as a slice ("fog", needs Play), split from Hex flower: the
 * service, Start exploring and the reveal items, the `explore-*` map note
 * keys, the `explore-play` action, Sees and Peek. Built off, a map's keys stay
 * in its note untouched.
 */

/** A map under fog (HF11) and the party's own hex clicked on it. */
function fogged() {
  const map = { name: "m", gridSize: { cols: 5, rows: 5 }, gridOffset: { x: 0, y: 0 }, exploreFog: "on", exploreSeen: ["2: 2"] };
  const p = { settings: { hexOrientation: "flat" }, getMap: (n: string) => (n === "m" ? map : undefined), saveSettings: async () => {} };
  setFog(p as never, new FogService(p as never, () => {}));
  const click = { map: "m", token: "p.md", from: "2_2", to: "2_2", orientation: "flat" as const, stagger: "odd" as const };
  return { map, p, click };
}

describeWith("fog", "fog on: fog of war (HF11)", () => {
  it("a fogged map has fog; the party's own hex is a look around", () => {
    const { map, p, click } = fogged();
    const fog = moduleFog(p as never, map as never);
    expect(fog?.hidden("2_2")).toBe(false);
    expect(fog?.hidden("0_0")).toBe(true);
    expect(modulePartyClick(p as never, click)).toBe("look");
  });
});

describeWithout("fog", "fog off: no fog", () => {
  it("no fog over any map, and the party's own hex does nothing", () => {
    const { map, p, click } = fogged();
    expect(moduleFog(p as never, map as never)).toBeUndefined();
    expect(modulePartyClick(p as never, click)).toBe("none");
  });
});

describeWith("fog", "fog on: what it owns", () => {
  it("the explore-* keys, explore-play and its menu items", () => {
    expect(registry.mapNoteFields().map((f) => f.key)).toEqual(expect.arrayContaining(["explore-fog", "explore-seen", "explore-reveal", "explore-peek"]));
    expect(ACTION_POLICY["explore-play"]?.modes).toEqual(["play", "build", "god"]);
    for (const id of ["hex.explore-start", "hex.explore-reveal-hex", "hex.explore-hide-hex", "hex.explore-stop"]) expect(MENU_ACTIONS[id]).toBe("explore-play");
  });

  it("the party's controls under fog: Sees, Peek, Reveal hexes, Stop", () => {
    const { p } = fogged();
    expect(modulePartyControls(p as never, { map: "m", hex: "2_2", token: "p.md" }).map((c) => c.label)).toEqual(["Sees", "Peek", "Reveal hexes", "Exploring"]);
  });
});

describeWithout("fog", "fog off: no trace, data kept", () => {
  it("no keys, action or menu items", () => {
    expect(registry.mapNoteFields().map((f) => f.key)).not.toContain("explore-fog");
    expect(ACTION_POLICY["explore-play"]).toBeUndefined();
    expect(MENU_ACTIONS["hex.explore-start"]).toBeUndefined();
    expect(registry.module("fog")).toBeUndefined();
  });

  it("a note's explore-* keys survive a rewrite as the user's own", () => {
    const note = ["---", "hexmaker-map: 6", "palette: Default", "cols: 3", "rows: 3", "explore-fog: on", 'explore-seen: ["1: 1"]', "---", "", "## Hexes", "", "| Hex | Terrain |", "| --- | --- |", "| 1_1 | grass |", ""].join("\n");
    const read = readMapNote(note);
    if (!read?.ok) throw new Error("not read");
    read.data.hexes.set("2_1", { terrain: "forest" });
    const text = updateMapNote(note, "m", read.data);
    expect(text).toContain("explore-fog: on");
    expect(text).toContain('explore-seen: ["1: 1"]');
  });
});
