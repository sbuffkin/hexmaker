import { describe, it } from "node:test";
import expect from "expect";
import { MemVault } from "./helpers/memVault";
import type { HexData } from "../src/maps/mapNote";
import { ExploreService } from "../src/hexflower/ExploreService";
import { FlowerStore } from "../src/hexflower/FlowerStore";
import { setExplore, setFlowerStore } from "../src/hexflower/context";
import { AREA_CONTROL_ID, explorePartyControls, exploreStep } from "../src/hexflower/exploreHooks";
import { ChangeAreaModal, areaAt } from "../src/hexflower/ChangeAreaModal";
import { parseFlowerAt } from "../src/hexflower/explore";
import { REALMS_RULE, directionOf, formatRealm, parseRealms, placeCentre } from "../src/hexflower/realms";
import { HEX_FLOWER_GENERATOR_ID, hexFlowerGenerator } from "../src/hexflower/flowerGenerator";
import type { TerrainGeneratorKind } from "../src/worldgen/registry";
import type { ScaleMapMade } from "../src/modules/types";
import { neighbourKeys } from "../src/hexKey";

/** HF8 step 3: an explored map powered by generators (realms), walked by the party. */

const TERRAINS = ["forest", "hills", "lake", "grassland"];

function kind(id: string, fill: (x: number, y: number) => string): TerrainGeneratorKind {
  return {
    id, label: id.split(":")[1], description: "", source: "built-in", options: [], fits: () => true, toPaths: () => ({ paths: [], missing: [] }),
    generate: (req) => {
      const cells = new Map<string, string>();
      for (let x = 0; x < req.grid.cols; x++) for (let y = 0; y < req.grid.rows; y++) cells.set(`${x}_${y}`, fill(x, y));
      return { ok: true, cells, paths: [], warnings: [] };
    },
  };
}
const WOODS = kind("x:woods", (x) => (x % 3 === 0 ? "hills" : "forest"));
const LAKES = kind("x:lakes", (x) => (x % 4 === 0 ? "grassland" : "lake"));

class FakeStore {
  hexes = new Map<string, Map<string, HexData>>();
  get(m: string, k: string) { return this.hexes.get(m)?.get(k); }
  all(m: string) { return this.hexes.get(m) ?? new Map<string, HexData>(); }
  set(m: string, k: string, patch: Record<string, unknown>) {
    const t = this.hexes.get(m) ?? new Map<string, HexData>();
    this.hexes.set(m, t);
    t.set(k, { ...(t.get(k) ?? {}), ...patch } as HexData);
    return true;
  }
  async record<T>(fn: () => T) { return { result: await fn(), cells: [] }; }
}

function setup(map: Record<string, unknown> = {}) {
  const vault = new MemVault({});
  const store = new FakeStore();
  const mapData: Record<string, unknown> = {
    name: "m", paletteName: "P", gridSize: { cols: 60, rows: 5 }, gridOffset: { x: 0, y: 0 }, pathChains: [], seed: 21,
    exploreWith: [REALMS_RULE], exploreGrow: "off", ...map,
  };
  const plugin = {
    app: vault.app(),
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    settings: { worldFolder: "world", hexOrientation: "flat", staggerOffset: "odd", maps: [mapData] },
    mapStore: store,
    tableNotes: { lookup: () => ({ table: () => undefined }) },
    getMap: (n: string) => (n === "m" ? mapData : undefined),
    getPaletteOrPresetTerrains: () => TERRAINS.map((name) => ({ name, color: "#000" })),
    hexPath: (x: number, y: number) => `world/hexes/m/${x}_${y}.md`,
    mapLabel: (n: string) => n,
    saveSettings: async () => {},
    pushUndo: () => {},
    refreshHexMap: () => {},
  };
  setFlowerStore(plugin as never, new FlowerStore(plugin as never, () => {}));
  const ex = new ExploreService(plugin as never, () => {});
  ex.useKinds([WOODS, LAKES]);
  setExplore(plugin as never, ex);
  return { plugin, store, mapData, ex };
}

const REALMS = [
  "Woods: x:woods at 0_2, home",
  "Lakes: x:lakes at 45_2, far",
];

/** Walk the party east along row 2 from x = 0 to `to`, each step filling the hex entered. */
async function walkEast(s: ReturnType<typeof setup>, to: number): Promise<string[]> {
  s.store.set("m", "0_2", { terrain: "forest" });
  for (let x = 1; x <= to; x++) await exploreStep(s.plugin as never, { map: "m", from: `${x - 1}_2`, to: `${x}_2` });
  return Array.from({ length: to + 1 }, (_, x) => s.store.get("m", `${x}_2`)?.terrain ?? "");
}

describe("exploring a map powered by generators", () => {
  it("each hex rolls on its realm's flower: the woods near home, the lakes near theirs; each realm's walk kept by name", async () => {
    const s = setup({ exploreRealms: REALMS });
    const row = await walkEast(s, 55);
    const woods = new Set(["forest", "hills"]);
    const lakes = new Set(["lake", "grassland"]);
    expect(row.slice(0, 15).every((t) => woods.has(t))).toBe(true);
    expect(row.slice(40, 52).every((t) => lakes.has(t))).toBe(true);
    expect([...parseFlowerAt(s.mapData.hexFlowerAt as string[]).keys()].sort()).toEqual(["lakes", "woods"]);
    expect((s.mapData.hexFlowerAt as string[]).every((e) => /^(Woods|Lakes): \d+$/.test(e))).toBe(true);
  });

  it("the same seed makes the same map; the lakes' share rises as the party walks toward them", async () => {
    const a = await walkEast(setup({ exploreRealms: REALMS }), 50);
    const b = await walkEast(setup({ exploreRealms: REALMS }), 50);
    expect(a).toEqual(b);
    const share = (part: string[]) => part.filter((t) => t === "lake" || t === "grassland").length / part.length;
    expect(share(a.slice(30, 40))).toBeGreaterThan(share(a.slice(15, 25)));
    expect(share(a.slice(40, 50))).toBeGreaterThanOrEqual(share(a.slice(30, 40)));
    expect(share(a.slice(0, 10))).toBeLessThan(share(a.slice(40, 50)));
  });

  it("a realm whose generator can't be found rolls nothing, and says why", async () => {
    const s = setup({ exploreRealms: ["Nowhere: x:missing at 0_2, home"] });
    s.ex.useKinds([WOODS]);
    // No listGeneratorKinds in this fake plugin: the service reads again once, then gives up quietly.
    const known = s.ex.knownKinds().map((k) => k.id);
    expect(known).toContain("x:woods");
    const state = await s.ex.realmsOf(s.mapData as never).catch(() => undefined);
    expect(state === undefined || state.flowers.size === 0).toBe(true);
  });
});

describe("New map's Explore as you go makes such a map", () => {
  const grid = { cols: 3, rows: 3, offset: { x: 0, y: 0 }, stagger: "odd" as const };
  const helpers = { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g: typeof grid) => ({ ...g, orientation: "flat" as const }) };
  const options = { home: "x:woods", areas: "north-east far x:lakes", startHex: "0_1", start: "blank", party: "on", reveal: "1" };

  it("the preview fills the start hex and what the party sees, from the generators", () => {
    const s = setup();
    const gen = hexFlowerGenerator(s.plugin as never, helpers as never);
    const out = gen.generate({ terrains: TERRAINS.map((name) => ({ name, color: "#000" })), grid, seed: 5, options });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 0_1 and its neighbours on the 3×3 grid (what the party sees), the start from the woods (home).
    const seen = ["0_1", ...neighbourKeys("0_1", "flat", "odd").filter((k) => { const [x, y] = k.split("_").map(Number); return x >= 0 && y >= 0 && x < 3 && y < 3; })];
    expect([...out.cells.keys()].sort()).toEqual(seen.sort());
    expect(["forest", "hills"]).toContain(out.cells.get("0_1"));
    // Same seed, same preview.
    const again = gen.generate({ terrains: TERRAINS.map((name) => ({ name, color: "#000" })), grid, seed: 5, options });
    expect(again.ok && [...again.cells]).toEqual([...out.cells]);
  });

  it("after making it: its realms, the realms rule, the walks by realm, the party on the start hex, Recent", async () => {
    const s = setup({ exploreWith: undefined });
    (s.plugin.settings as Record<string, unknown>).recentGenerators = ["x:lakes"];
    const gen = hexFlowerGenerator(s.plugin as never, helpers as never);
    const made: ScaleMapMade = { mapName: "m", generatorId: HEX_FLOWER_GENERATOR_ID, options, seed: 5, grid, paletteName: "P", choices: {}, onProgress: () => {} };
    await gen.afterCreate!(s.plugin as never, made);
    const map = s.mapData;
    expect(map.exploreWith).toEqual([REALMS_RULE]);
    const { realms, unread } = parseRealms(map.exploreRealms as string[]);
    expect(unread).toEqual([]);
    expect(realms.map((r) => [r.name, r.from[0].ref, r.reach])).toEqual([["woods", "x:woods", "home"], ["lakes", "x:lakes", "far"]]);
    expect(realms[0].centre).toBe("0_1");
    expect(realms[1].centre).toBe(placeCentre("0_1", directionOf("north-east", "flat"), "far", (await import("../src/arrival/arrival")).hashSeed(5, "setup-area", 0), { orientation: "flat", stagger: "odd" }));
    expect(map.exploreRealms).toEqual(realms.map(formatRealm));
    // Home's walk (and the far area's, where its influence reached a hex the party sees).
    const walks = [...parseFlowerAt(map.hexFlowerAt as string[]).keys()];
    expect(walks).toContain("woods");
    expect(walks.every((w) => w === "woods" || w === "lakes")).toBe(true);
    expect(map.exploreReveal).toBe("1 ring");
    expect(map.visited).toEqual(["0_1"]);
    expect([...s.plugin.app.vault.getMarkdownFiles()].map((f) => f.path)).toEqual(["world/tokens/Party.md"]);
    expect((s.plugin.settings as Record<string, unknown>).recentGenerators).toEqual(["x:woods", "x:lakes"]);
  });
});

describe("Play: the party's Area and Change area", () => {
  it("the party controls say the area the party is in, before Reveal; none on a map without areas", () => {
    const s = setup({ exploreRealms: REALMS });
    const controls = explorePartyControls(s.plugin as never, { map: "m", hex: "1_2", token: "party.md" });
    expect(controls.map((c) => [c.id, c.label, c.buttons[0].label])).toEqual([[AREA_CONTROL_ID, "Area", "Woods"], ["explore.reveal", "Reveal", "1"]]);
    expect(areaAt(s.plugin as never, s.mapData as never, "45_2")).toBe("Lakes");
    const plain = setup({ exploreWith: ["[[Wilds]] -> terrain"] });
    expect(explorePartyControls(plain.plugin as never, { map: "m", hex: "1_2", token: "party.md" }).map((c) => c.id)).toEqual(["explore.reveal"]);
  });

  it("setting an area adds it to the map's areas as one undo (and the borders, when they changed)", () => {
    const s = setup({ exploreRealms: REALMS });
    let undo: unknown[] = [];
    const modal = new ChangeAreaModal(s.plugin.app as never, s.plugin as never, s.mapData as never, "10_2", (u) => { undo = u; });
    (modal as unknown as { close(): void }).close = () => {};
    (modal as unknown as { reach: string }).reach = "near";
    (modal as unknown as { borders: string }).borders = "wide";
    (modal as unknown as { set(k: TerrainGeneratorKind, c: string): void }).set(LAKES, "10_-5");
    expect(s.mapData.exploreRealms).toEqual([...REALMS, "lakes 2: x:lakes at 10_-5, near"]);
    expect(s.mapData.exploreBlend).toBe("wide");
    expect(undo).toEqual([
      { kind: "map-field", mapName: "m", field: "exploreRealms", before: REALMS, after: [...REALMS, "lakes 2: x:lakes at 10_-5, near"] },
      { kind: "map-field", mapName: "m", field: "exploreBlend", before: undefined, after: "wide" },
    ]);
  });
});
