/**
 * A terrain renamed by hand in a palette note (#43): the rename is spotted
 * by comparing revisions of the note, and "Rename everywhere" is offered
 * (never applied without the click) when something still uses the old name.
 */
import { describe, it, beforeEach } from "node:test";
import expect from "expect";
import { TFile } from "obsidian";
import { Notice } from "./__mocks__/obsidian"; // the mock: Notice.shown records every notice
import { detectTerrainRenames, foldRenames, renameOfferText, terrainUse } from "../src/palettes/terrainRename";
import { PaletteStore } from "../src/palettes/PaletteStore";
import { DEFAULT_SETTINGS } from "../src/constants";
import type { HexmakerPluginSettings, MapData, TerrainColor } from "../src/types";
import { MemVault } from "./helpers/memVault";

(globalThis as Record<string, unknown>).window ??= globalThis;

const T = (name: string, color: string): TerrainColor => ({ name, color });
const BASE = [T("sea", "#29507f"), T("forest", "#2d5a27"), T("hills", "#8a7f5a")];

describe("detectTerrainRenames", () => {
  it("a name changed in its row is a rename", () => {
    expect(detectTerrainRenames(BASE, [BASE[0], T("woods", "#2d5a27"), BASE[2]])).toEqual([{ from: "forest", to: "woods" }]);
  });

  it("renamed and recoloured in the same row is still a rename (same row)", () => {
    expect(detectTerrainRenames(BASE, [BASE[0], T("woods", "#000000"), BASE[2]])).toEqual([{ from: "forest", to: "woods" }]);
  });

  it("renamed and moved is a rename when the colour matches", () => {
    expect(detectTerrainRenames(BASE, [T("woods", "#2D5A27"), BASE[0], BASE[2]])).toEqual([{ from: "forest", to: "woods" }]);
  });

  it("a change of case is a rename", () => {
    expect(detectTerrainRenames(BASE, [BASE[0], T("Forest", "#2d5a27"), BASE[2]])).toEqual([{ from: "forest", to: "Forest" }]);
  });

  it("only one reading counts: two new terrains with the old colour are no rename", () => {
    const after = [BASE[0], BASE[2], T("woods", "#2d5a27"), T("jungle", "#2d5a27")];
    expect(detectTerrainRenames(BASE, after)).toEqual([]);
  });

  it("a terrain added or removed (nothing in its place) is no rename", () => {
    expect(detectTerrainRenames(BASE, [...BASE, T("swamp", "#445544")])).toEqual([]);
    expect(detectTerrainRenames(BASE, [BASE[0], BASE[2]])).toEqual([]);
    expect(detectTerrainRenames(BASE, BASE)).toEqual([]);
  });

  it("two rows renamed at once: both found", () => {
    expect(detectTerrainRenames(BASE, [T("ocean", "#29507f"), BASE[1], T("downs", "#8a7f5a")])).toEqual([
      { from: "sea", to: "ocean" },
      { from: "hills", to: "downs" },
    ]);
  });
});

describe("foldRenames", () => {
  const names = (...n: string[]) => new Set(n);

  it("a name typed a letter at a time is one rename, from the first name to the last", () => {
    let p = foldRenames([], [{ from: "forest", to: "w" }], names("w"));
    p = foldRenames(p, [{ from: "w", to: "wo" }], names("wo"));
    p = foldRenames(p, [{ from: "wo", to: "woods" }], names("woods"));
    expect(p).toEqual([{ from: "forest", to: "woods" }]);
  });

  it("renamed back: nothing left to offer", () => {
    const p = foldRenames([{ from: "forest", to: "woods" }], [{ from: "woods", to: "forest" }], names("forest"));
    expect(p).toEqual([]);
  });

  it("the old name added back, or the new one deleted: dropped", () => {
    expect(foldRenames([{ from: "forest", to: "woods" }], [], names("forest", "woods"))).toEqual([]);
    expect(foldRenames([{ from: "forest", to: "woods" }], [], names("sea"))).toEqual([]);
  });
});

describe("terrainUse and the offer's text", () => {
  const hexes: Record<string, Map<string, { terrain?: string }>> = {
    a: new Map([["0_0", { terrain: "forest" }], ["1_0", { terrain: "forest" }], ["2_0", { terrain: "sea" }]]),
    b: new Map([["0_0", { terrain: "forest" }]]),
    c: new Map(),
  };
  const maps = [{ name: "a" }, { name: "b" }, { name: "c", baseTerrain: "forest" }];

  it("counts hexes per map and base terrains", () => {
    expect(terrainUse("forest", maps, (m) => hexes[m])).toEqual({ hexes: 3, hexMaps: ["a", "b"], baseOf: ["c"] });
    expect(terrainUse("hills", maps, (m) => hexes[m])).toEqual({ hexes: 0, hexMaps: [], baseOf: [] });
  });

  it("says what still has the old name", () => {
    const use = terrainUse("forest", maps, (m) => hexes[m]);
    expect(renameOfferText("Default", { from: "forest", to: "woods" }, use, 2)).toBe(
      '"forest" is now "woods" in the Default palette. Still named "forest": 3 hexes on 2 maps, the base terrain of 1 map, 2 tables.',
    );
    expect(renameOfferText("P", { from: "x", to: "y" }, { hexes: 1, hexMaps: ["a"], baseOf: [] }, 0)).toBe(
      '"x" is now "y" in the P palette. Still named "x": 1 hex on 1 map.',
    );
  });
});

describe("palettes on a fresh install are copies of the shipped ones", () => {
  it("settings filled from DEFAULT_SETTINGS don't alias its palettes (a rename never changes the constant)", async () => {
    const { palettesOnLoad } = await import("../src/palettes/PaletteStore");
    const settings = Object.assign({}, DEFAULT_SETTINGS);
    const got = palettesOnLoad(settings.terrainPalettes, DEFAULT_SETTINGS.terrainPalettes);
    expect(got).not.toBe(DEFAULT_SETTINGS.terrainPalettes);
    expect(got[0].terrains).not.toBe(DEFAULT_SETTINGS.terrainPalettes[0].terrains);
    expect(got.map((p) => p.name)).toEqual(DEFAULT_SETTINGS.terrainPalettes.map((p) => p.name));
  });
});

// ── PaletteStore: the offer ──────────────────────────────────────────────

function harness(maps: { name: string; paletteName: string; baseTerrain?: string }[], hexes: Record<string, Map<string, { terrain?: string }>>) {
  const vault = new MemVault();
  const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HexmakerPluginSettings;
  const settings: HexmakerPluginSettings = { ...defaults, worldFolder: "world", maps: maps as MapData[] };
  const calls: { renamed: string[][]; tables: number } = { renamed: [], tables: 0 };
  const plugin = {
    settings,
    manifest: { dir: ".obsidian/plugins/hexmaker" },
    app: vault.app(),
    saveData: async () => {},
    refreshHexMap: () => {},
    refreshPaletteEditors: () => {},
    ensureTablesForNewTerrains: async () => { calls.tables++; },
    getPaletteByName: (name: string) => settings.terrainPalettes.find((p) => p.name === name),
    mapsOnPalette: (p: string) => settings.maps.filter((m) => m.paletteName === p),
    mapStore: { all: (m: string) => hexes[m] ?? new Map() },
    terrainTableFiles: () => [],
    renameTerrainEverywhere: async (p: string, from: string, to: string) => { calls.renamed.push([p, from, to]); return "backups/x.json.gz"; },
  };
  const store = new PaletteStore(plugin as never);
  const file = (p: string) => plugin.app.vault.getAbstractFileByPath(p) as TFile;
  return { vault, settings, store, file, calls, plugin };
}

/** The palette note with one terrain renamed in its row. */
function renameRow(text: string, from: string, to: string): string {
  const row = text.split("\n").find((l) => l.startsWith(`| ${from} |`))!;
  return text.replace(row, row.replace(`| ${from} |`, `| ${to} |`));
}

describe("PaletteStore: a terrain renamed by hand", () => {
  beforeEach(() => { Notice.shown = []; });

  const setup = async () => {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as HexmakerPluginSettings;
    const [first, second] = defaults.terrainPalettes;
    const t = first.terrains[1].name;
    const h = harness(
      [{ name: "a", paletteName: first.name }, { name: "b", paletteName: second.name }],
      { a: new Map([["0_0", { terrain: t }], ["1_0", { terrain: t }]]), b: new Map([["0_0", { terrain: t }]]) },
    );
    await h.store.init();
    const path = h.store.notePathOf(first.name)!;
    return { h, path, palette: first.name, t };
  };

  it("offers Rename everywhere, counting only maps on that palette; nothing changes until clicked", async () => {
    const { h, path, palette, t } = await setup();
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, t, "Woodland"));
    Notice.shown = [];
    h.store.onModify(h.file(path));
    await h.store.sync();
    const offer = Notice.shown.filter((n) => n.msg.includes("is now"));
    expect(offer).toHaveLength(1);
    expect(offer[0].msg).toBe(`"${t}" is now "Woodland" in the ${palette} palette. Still named "${t}": 2 hexes on 1 map.`);
    expect(offer[0].timeout).toBe(0);
    expect(h.calls.renamed).toEqual([]);
    // the new name's tables wait for the answer
    expect([...h.store.heldTerrainNames()]).toEqual(["Woodland"]);
    await h.store.renames.answer(path, { from: t, to: "Woodland" }, true, palette);
    expect(h.calls.renamed).toEqual([[palette, t, "Woodland"]]);
    expect(h.store.heldTerrainNames().size).toBe(0);
    expect(Notice.shown.some((n) => n.msg.startsWith(`Renamed "${t}" to "Woodland" everywhere. A backup is in`))).toBe(true);
  });

  it("dismissed: nothing renamed, and the new name gets its tables", async () => {
    const { h, path, palette, t } = await setup();
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, t, "Woodland"));
    h.store.onModify(h.file(path));
    await h.store.sync();
    const before = h.calls.tables;
    await h.store.renames.answer(path, { from: t, to: "Woodland" }, false, palette);
    expect(h.calls.renamed).toEqual([]);
    expect(h.store.heldTerrainNames().size).toBe(0);
    expect(h.calls.tables).toBeGreaterThan(before);
  });

  it("no offer when nothing on that palette's maps uses the old name", async () => {
    const { h, path } = await setup();
    const pal = h.settings.terrainPalettes.find((p) => h.store.notePathOf(p.name) === path)!;
    const unused = pal.terrains[0].name;
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, unused, "Brine"));
    Notice.shown = [];
    h.store.onModify(h.file(path));
    await h.store.sync();
    expect(Notice.shown.filter((n) => n.msg.includes("is now"))).toEqual([]);
    expect(h.store.heldTerrainNames().size).toBe(0);
  });

  it("while the note is being typed in, renames fold together and are offered once the user leaves it", async () => {
    const { h, path, t } = await setup();
    let editing = true;
    (h.store as unknown as { isBeingEdited: () => boolean }).isBeingEdited = () => editing;
    let text = h.vault.files.get(path)!;
    let prev = t;
    for (const name of ["W", "Wo", "Woodland"]) {
      text = renameRow(text, prev, name);
      prev = name;
      h.vault.files.set(path, text);
      h.store.onModify(h.file(path));
      await h.store.sync();
    }
    expect(Notice.shown.filter((n) => n.msg.includes("is now"))).toEqual([]);
    expect(h.store.renames.pendingFor(path)).toEqual([{ from: t, to: "Woodland" }]);
    expect([...h.store.heldTerrainNames()]).toEqual(["Woodland"]);
    editing = false;
    h.store.flushPendingDerived();
    await h.store.sync();
    const offer = Notice.shown.filter((n) => n.msg.includes("is now"));
    expect(offer).toHaveLength(1);
    expect(offer[0].msg).toContain(`"${t}" is now "Woodland"`);
  });

  it("renamed in the note while Obsidian was closed: offered once the maps are loaded", async () => {
    const { h, path, palette, t } = await setup();
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, t, "Woodland"));
    Notice.shown = [];
    const next = new PaletteStore(h.plugin as never); // the next start, data.json still says the old name
    await next.init();
    expect(Notice.shown.filter((n) => n.msg.includes("is now"))).toEqual([]);
    expect([...next.heldTerrainNames()]).toEqual(["Woodland"]);
    await next.offerPendingRenames();
    const offer = Notice.shown.filter((n) => n.msg.includes("is now"));
    expect(offer.map((n) => n.msg)).toEqual([`"${t}" is now "Woodland" in the ${palette} palette. Still named "${t}": 2 hexes on 1 map.`]);
  });

  it("renamed again after the offer: the old offer goes, a new one comes", async () => {
    const { h, path, palette, t } = await setup();
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, t, "Woodland"));
    h.store.onModify(h.file(path));
    await h.store.sync();
    h.vault.files.set(path, renameRow(h.vault.files.get(path)!, "Woodland", "Wildwood"));
    h.store.onModify(h.file(path));
    await h.store.sync();
    const offers = Notice.shown.filter((n) => n.msg.includes("is now"));
    expect(offers.map((n) => [n.msg.includes('"Wildwood"'), n.hidden])).toEqual([[false, true], [true, false]]);
    // the stale offer's button does nothing
    await h.store.renames.answer(path, { from: t, to: "Woodland" }, true, palette);
    expect(h.calls.renamed).toEqual([]);
  });
});
