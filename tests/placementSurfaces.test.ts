/**
 * The owner's UI worksheet (2026-10-11) applied to the maps, new maps,
 * regions/overworlds/biomes, world types, palette editor, random tables,
 * workflows and export surfaces: every tagged id lands on its layer, the
 * dropped controls are gone, menus get Advanced ▸ / Debug ▸ submenus, and
 * the random tables list refreshes itself (so its ↺ button can be Debug).
 */
import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLACEMENT, layerOf, type Layer } from "../src/ui/placement";
import { PlacedMenu, type MenuLike } from "../src/ui/placedMenu";
import { Menu as ObsidianMenu, type MenuItem as ObsidianMenuItem } from "obsidian";
import { groupAgrees } from "../src/ui/placeGroup";
import { newMapOptionIds, newMapOptionId } from "../src/worldgen/newMapOptionIds";
import { ORBITS_ID, ORBITS_OPTIONS } from "../src/space/orbits";
import { OVERLAND_ID, OVERLAND_OPTIONS, PLANET_SURFACE_ID, PLANET_SURFACE_OPTIONS, REGION_DETAIL_ID, REGION_DETAIL_OPTIONS } from "../src/worldgen/procedural/planetSurface";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS } from "../src/space/starScatter";
import { WORLD_BIOMES_ID, WORLD_BIOMES_OPTIONS } from "../src/overworld/worldBiomes";
import { ORBIT_TYPE_KEY, ROUTE_TYPE_KEY } from "../src/worldgen/generatorPathTypes";
import { LIST_REFRESH_MS, DETAIL_REFRESH_MS, ListSignatures, listSignature, touchesList } from "../src/random-tables/listRefresh";

interface Resolved { id: string; group: string; subgroup: string; choice: string }

const SURFACES = [
  "Maps modal",
  "New maps & map links",
  "Regions, overworlds & biomes",
  "Space: world types",
  "Palette editor",
  "Random tables",
  "Workflows",
  "Export",
];
const TIER: Record<string, Layer | "drop"> = { keep: "main", simple: "main", advanced: "advanced", overkill: "debug", drop: "drop" };
/**
 * Owner calls that override a worksheet tag. The Maps modal's background
 * image row stays together on the main page (2026-10-11: customisation
 * stays simple), so its "Pick image…" isn't Advanced.
 */
// Round 10 (owner 2026-10-12): the export dialog's lone Advanced item moved to the basic options.
// Owner 2026-10-12 (as the setup wizard): New map's generator options are above the fold; its Advanced holds the tuning sliders.
const NEW_MAP_OPTIONS_MAIN = [
  "NewMap.overlandWater", "NewMap.overlandClimate", "NewMap.overlandRelief", "NewMap.overlandSea", "NewMap.planetRelief",
  "NewMap.regionDetailInfluence", "NewMap.regionDetailVariety", "NewMap.starRouteType", "NewMap.orbitsPathType",
];
const OVERRIDES: Record<string, Layer> = {
  "MapProps.backgroundImagePicker": "main",
  "MapExport.showRegionOverlay": "main",
  ...Object.fromEntries(NEW_MAP_OPTIONS_MAIN.map((id) => [id, "main" as Layer])),
};

const resolved = (JSON.parse(readFileSync(join("dev", "ui-inventory", "inputs-tags-resolved.json"), "utf8")) as Resolved[])
  .filter((x) => SURFACES.includes(x.group));

const read = (...p: string[]) => readFileSync(join(...p), "utf8").replace(/\r\n/g, "\n");
function allSrc(): string {
  let out = "";
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith("placement.ts")) out += readFileSync(p, "utf8") + "\n";
    }
  };
  walk("src");
  return out;
}
const SRC = allSrc();

describe("worksheet placement: maps, new maps, regions, world types, palettes, tables, workflows, export", () => {
  it("covers the surfaces (sanity: the worksheet still has them)", () => {
    expect(resolved.length).toBeGreaterThan(400);
    for (const g of SURFACES) expect(resolved.some((x) => x.group === g)).toBe(true);
  });

  for (const item of resolved.filter((x) => x.choice !== "drop")) {
    const want = OVERRIDES[item.id] ?? TIER[item.choice];
    it(`${item.id} (${item.choice}) is ${want}`, () => {
      expect(layerOf(item.id)).toBe(want);
      // keep is the default (and so is an override to main): no entry. simple is listed as main.
      if (item.choice === "keep" || OVERRIDES[item.id] === "main") expect(Object.prototype.hasOwnProperty.call(PLACEMENT, item.id)).toBe(false);
      else expect(PLACEMENT[item.id]).toBe(want);
      // Anything off the main layer is asked for by id in the code (place / target / add).
      if (want !== "main") expect(SRC.includes(`"${item.id}"`)).toBe(true);
    });
  }

  it("dropped ids have no placement entry (the control is removed, not hidden)", () => {
    for (const item of resolved.filter((x) => x.choice === "drop")) expect(PLACEMENT[item.id]).toBeUndefined();
  });

  it("grouped controls share one layer", () => {
    const groups = [
      ["MapModal.propsFolderName", "MapModal.propsRenameFolder"],
      ["MapModal.propsWeatherTable", "MapModal.propsWeatherClear", "MapModal.propsRumoursTable", "MapModal.propsRumoursClear", "MapProps.sectionTablePicker"],
      ["NewMap.bgPick", "NewMap.bgClear", "NewMapSetup.backgroundImagePicker"],
    ];
    for (const g of groups) expect(groupAgrees(g)).toBe(true);
  });
});

describe("dropped controls are gone", () => {
  it("Link submap: the inline create form", () => {
    const src = read("src", "hex-map", "SubmapPickerModal.ts");
    expect(src).not.toMatch(/Create & link new map|handleCreateAndLink|duckmage-submap-create|Map terrain theme/);
    // Making a map is the New map form's job (New location…).
    expect(src).toMatch(/New location…/);
    expect(read("styles.css")).not.toMatch(/duckmage-submap-create/);
  });

  it("dead code: newMapFields.ts", () => {
    expect(existsSync(join("src", "hex-map", "newMapFields.ts"))).toBe(false);
    expect(SRC).not.toMatch(/renderNewMapFields/);
  });

  it("Biome form: the typed weight box (the slider stays)", () => {
    const src = read("src", "overworld", "BiomeLibraryModal.ts");
    expect(src).not.toMatch(/weight value/);
    expect(src).toMatch(/type: "range"[^\n]*weight/);
  });

  it("Table picker: Open tables view", () => {
    expect(read("src", "hex-map", "FolderTreePickerModal.ts")).not.toMatch(/Open tables view|onOpenView/);
    expect(read("styles.css")).not.toMatch(/duckmage-table-picker-(topbar|view-btn)/);
  });

  it("New map form: the old \"More\" fold is replaced by the Advanced dropdown", () => {
    const src = read("src", "worldgen", "NewMapSetupModal.ts");
    expect(src).not.toMatch(/duckmage-setup-more|"More: folder name/);
    expect(src).toMatch(/new Disclosure\(this\.app, "NewMap"/);
  });
});

describe("New map form: generator options by inventory id", () => {
  const optionKeys: Record<string, string[]> = {
    [OVERLAND_ID]: OVERLAND_OPTIONS.map((o) => o.key),
    [PLANET_SURFACE_ID]: PLANET_SURFACE_OPTIONS.map((o) => o.key),
    [REGION_DETAIL_ID]: REGION_DETAIL_OPTIONS.map((o) => o.key),
    [WORLD_BIOMES_ID]: WORLD_BIOMES_OPTIONS.map((o) => o.key),
    [STAR_SCATTER_ID]: [...STAR_SCATTER_OPTIONS.map((o) => o.key), ROUTE_TYPE_KEY],
    [ORBITS_ID]: [...ORBITS_OPTIONS.map((o) => o.key), ORBIT_TYPE_KEY],
  };

  it("every mapped option is a real option of its generator", () => {
    expect(Object.keys(newMapOptionIds()).sort()).toEqual(Object.keys(optionKeys).sort());
    for (const [kind, keys] of Object.entries(newMapOptionIds())) {
      for (const key of Object.keys(keys)) expect(optionKeys[kind]).toContain(key);
    }
  });

  it("every generator option is main (owner 2026-10-12, as the wizard); the tuning sliders and Make every region now are Advanced", () => {
    for (const [kind, keys] of Object.entries(newMapOptionIds())) {
      for (const key of Object.keys(keys)) expect([kind, key, layerOf(newMapOptionId(kind, key)!)]).toEqual([kind, key, "main"]);
    }
    expect(layerOf(newMapOptionId(STAR_SCATTER_ID, ROUTE_TYPE_KEY)!)).toBe("main");
    expect(layerOf(newMapOptionId(ORBITS_ID, ORBIT_TYPE_KEY)!)).toBe("main");
    expect(layerOf("NewMap.tuning")).toBe("advanced");
    expect(layerOf("NewMap.makeAllRegions")).toBe("advanced");
    expect(layerOf("Wizard.makeAllRegions")).toBe("advanced");
    expect(newMapOptionId("nope", "water")).toBeUndefined();
  });
});

/** A menu that records its items' titles (clicks run their callbacks). */
class FakeMenu implements MenuLike {
  items: string[] = [];
  clicks: (() => void)[] = [];
  addSeparator(): this {
    this.items.push("---");
    this.clicks.push(() => {});
    return this;
  }
  addItem(cb: (item: never) => unknown): this {
    let title = "";
    let click: () => void = () => {};
    const item = {
      setTitle: (t: string) => { title = t; return item; },
      setIcon: () => item,
      setDisabled: () => item,
      setChecked: () => item,
      onClick: (f: () => void) => { click = f; return item; },
    };
    cb(item as never);
    this.items.push(title);
    this.clicks.push(click);
    return this;
  }
}

describe("menus: Advanced ▸ and Debug ▸ submenus (src/ui/placedMenu.ts)", () => {
  const map: Record<string, Layer> = { "M.a": "advanced", "M.b": "advanced", "M.d": "debug", "M.h": "hidden" };
  const noop = () => {};
  const fill = (pm: PlacedMenu) => {
    pm.add("M.main", { label: "Open", onClick: noop });
    pm.add("M.a", { label: "Exclude A", onClick: noop });
    pm.add("M.d", { label: "Raw", onClick: noop });
    pm.add("M.h", { label: "Gone", onClick: noop });
    pm.add("M.b", { label: "Exclude B", onClick: noop, isSet: true });
  };
  const lastShown = () => ObsidianMenu.shown[ObsidianMenu.shown.length - 1].items.map((i) => (i === "separator" ? "---" : i.title));

  it("main items stay; Advanced ones open from an Advanced ▸ row at the end, with Debug ▸ last inside it in debug mode", () => {
    ObsidianMenu.shown = [];
    const menu = new FakeMenu();
    const pm = new PlacedMenu(menu, true, map);
    fill(pm);
    pm.finish(() => ({ x: 1, y: 2 }));
    // One of the two is set: the row says so.
    expect(menu.items).toEqual(["Open", "---", "Advanced · 1 set ▸"]);
    menu.clicks[2]();
    expect(lastShown()).toEqual(["Exclude A", "Exclude B", "Debug ▸"]);
    ObsidianMenu.shown[ObsidianMenu.shown.length - 1].items.filter((i): i is ObsidianMenuItem => i !== "separator")[2].click?.();
    expect(lastShown()).toEqual(["Raw"]);
  });

  it("no Debug ▸ while debug mode is off, and nothing hidden is added", () => {
    ObsidianMenu.shown = [];
    const menu = new FakeMenu();
    const pm = new PlacedMenu(menu, false, map);
    fill(pm);
    pm.finish(() => ({ x: 0, y: 0 }));
    menu.clicks[2]();
    expect(lastShown()).toEqual(["Exclude A", "Exclude B"]);
    expect(JSON.stringify(ObsidianMenu.shown.map((m) => m.items)) + menu.items.join()).not.toMatch(/Gone|Raw/);
  });

  it("nothing advanced: no separator, no submenu", () => {
    const menu = new FakeMenu();
    const pm = new PlacedMenu(menu, true, {});
    pm.add("M.main", { label: "Open", onClick: noop });
    pm.finish(() => ({ x: 0, y: 0 }));
    expect(menu.items).toEqual(["Open"]);
  });

  it("a menu with no main items shows its Advanced items directly, never a lone Advanced ▸", () => {
    const menu = new FakeMenu();
    const pm = new PlacedMenu(menu, false, map);
    pm.add("M.a", { label: "Exclude A", onClick: noop });
    pm.add("M.b", { label: "Exclude B", onClick: noop });
    pm.finish(() => ({ x: 0, y: 0 }));
    expect(menu.items).toEqual(["Exclude A", "Exclude B"]);
  });

  it("…and Debug ▸ still only in debug mode, after them", () => {
    const off = new FakeMenu();
    const a = new PlacedMenu(off, false, map);
    a.add("M.a", { label: "Exclude A", onClick: noop });
    a.add("M.d", { label: "Raw", onClick: noop });
    a.finish(() => ({ x: 0, y: 0 }));
    expect(off.items).toEqual(["Exclude A"]);
    const on = new FakeMenu();
    const b = new PlacedMenu(on, true, map);
    b.add("M.a", { label: "Exclude A", onClick: noop });
    b.add("M.d", { label: "Raw", onClick: noop });
    b.finish(() => ({ x: 0, y: 0 }));
    expect(on.items).toEqual(["Exclude A", "---", "Debug ▸"]);
  });

  it("items added with addItem count as main", () => {
    const menu = new FakeMenu();
    const pm = new PlacedMenu(menu, false, map);
    pm.addItem((i) => i.setTitle("Open in new tab"));
    pm.add("M.a", { label: "Exclude A", onClick: noop });
    pm.finish(() => ({ x: 0, y: 0 }));
    // One Advanced item is shown inline (round 10).
    expect(menu.items).toEqual(["Open in new tab", "Exclude A"]);
  });

  it("the map list's and the tables view's context menus use it", () => {
    expect(read("src", "hex-map", "MapModal.ts")).toMatch(/layers\.add\("MapModal\.mapRowContextGenerator"/);
    const rt = read("src", "random-tables", "RandomTableView.ts");
    for (const id of ["folderMenuRollPicker", "folderMenuEncounters", "fileMenuRollPicker", "fileMenuEncounters"]) {
      expect(rt).toMatch(new RegExp(`layers\\.add\\("RTView\\.${id}"`));
    }
    // An excluded table or folder counts as set.
    expect(rt).toMatch(/isSet: rollExcluded/);
    expect(rt).toMatch(/isSet: encExcluded/);
  });
});

describe("random tables list: refresh cadence (the ↺ button is Debug)", () => {
  const F = { tables: "world/tables", workflows: "world/workflows" };

  it("notes and folders in the tables or workflows folder touch the list; others don't", () => {
    expect(touchesList("world/tables/beach.md", F)).toBe(true);
    expect(touchesList("world/tables/coast", F)).toBe(true); // a folder
    expect(touchesList("world/tables", F)).toBe(true);
    expect(touchesList("world/workflows/loot.md", F)).toBe(true);
    expect(touchesList("world/towns/a.md", F)).toBe(false);
    expect(touchesList("world/tablesX/a.md", F)).toBe(false);
    // No tables folder: the whole vault is the tables folder.
    expect(touchesList("anything.md", { tables: "", workflows: "" })).toBe(true);
    expect(touchesList("world/workflows/loot.md", { tables: "world/tables", workflows: "" })).toBe(false);
  });

  it("only what the list shows counts as a change: a table's linked folder and type, a workflow's links", () => {
    const t = (fm: Record<string, unknown>) => listSignature(false, { frontmatter: fm });
    expect(t({ dice: 6 })).toBe(t({ dice: 20 }));
    expect(t({ linkedFolder: "[[towns]]" })).not.toBe(t({}));
    expect(t({ "table-type": "terrain-encounters" })).not.toBe(t({}));
    const w = (links: string[]) => listSignature(true, { links: links.map((link) => ({ link })) });
    expect(w(["tables/beach"])).not.toBe(w(["tables/beach", "tables/cave"]));
    expect(w([])).toBe(listSignature(true, null));
  });

  it("signatures: seen notes redraw only when they change; new ones when asked; renames carry over", () => {
    const sigs = new ListSignatures();
    expect(sigs.changed("a.md", "x")).toBe(false); // seeded by the list draw
    expect(sigs.changed("a.md", "x", true)).toBe(false);
    expect(sigs.changed("a.md", "y", true)).toBe(true);
    expect(sigs.changed("b.md", "x", true)).toBe(true); // first seen from a metadata change
    sigs.rename("a.md", "c.md");
    expect(sigs.changed("c.md", "y", true)).toBe(false);
    sigs.forget("c.md");
    expect(sigs.changed("c.md", "y", true)).toBe(true);
  });

  it("debounced: a burst of events is one redraw", () => {
    expect(LIST_REFRESH_MS).toBeGreaterThanOrEqual(100);
    expect(LIST_REFRESH_MS).toBeLessThanOrEqual(500);
    expect(DETAIL_REFRESH_MS).toBeLessThanOrEqual(500);
  });

  it("the view listens for every change the list depends on, and its manual refreshes are Debug", () => {
    const src = read("src", "random-tables", "RandomTableView.ts");
    for (const ev of ["create", "delete", "rename"]) {
      expect(src).toMatch(new RegExp(`vault\\.on\\("${ev}", \\(file[^)]*\\) => \\{\\n\\s+(if \\(touchesList|const f = this\\.listFolders|if \\(!touchesList)`));
    }
    expect(src).toMatch(/metadataCache\.on\("changed"/);
    expect(src).toMatch(/metadataCache\.on\("resolved", \(\) => this\.scheduleListRefresh\(\)\)/);
    // A linked table syncs on open and when its folder's notes change.
    expect(src).toMatch(/await this\.autoSyncLinkedFolder\(file\);\n\s+await this\.renderDetail\(\);/);
    expect(src).not.toMatch(/text: "↺",/);
    expect(layerOf("RTView.refreshList")).toBe("debug");
    expect(layerOf("RTView.refreshLinked")).toBe("debug");
  });
});
