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
import { MenuLayers, type MenuLike } from "../src/ui/menuLayers";
import { groupAgrees } from "../src/ui/placeGroup";
import { NEW_MAP_OPTION_IDS, newMapOptionId } from "../src/worldgen/newMapOptionIds";
import { ORBITS_ID, ORBITS_OPTIONS } from "../src/worldgen/procedural/orbits";
import { OVERLAND_ID, OVERLAND_OPTIONS, PLANET_SURFACE_ID, PLANET_SURFACE_OPTIONS, REGION_DETAIL_ID, REGION_DETAIL_OPTIONS } from "../src/worldgen/procedural/planetSurface";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS } from "../src/worldgen/procedural/starScatter";
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
    const want = TIER[item.choice];
    it(`${item.id} (${item.choice}) is ${want}`, () => {
      expect(layerOf(item.id)).toBe(want);
      // keep is the default: no entry. simple is listed as main.
      if (item.choice === "keep") expect(Object.prototype.hasOwnProperty.call(PLACEMENT, item.id)).toBe(false);
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
    const src = read("src", "hex-map", "BiomeLibraryModal.ts");
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
    for (const [kind, keys] of Object.entries(NEW_MAP_OPTION_IDS)) {
      for (const key of Object.keys(keys)) expect(optionKeys[kind]).toContain(key);
    }
  });

  it("Overland's options and the path types are Advanced; Planet surface's water and climate stay main", () => {
    for (const k of ["water", "climate", "relief", "sea"]) expect(layerOf(newMapOptionId(OVERLAND_ID, k)!)).toBe("advanced");
    expect(layerOf(newMapOptionId(PLANET_SURFACE_ID, "water")!)).toBe("main");
    expect(layerOf(newMapOptionId(PLANET_SURFACE_ID, "relief")!)).toBe("advanced");
    expect(layerOf(newMapOptionId(STAR_SCATTER_ID, ROUTE_TYPE_KEY)!)).toBe("advanced");
    expect(layerOf(newMapOptionId(ORBITS_ID, ORBIT_TYPE_KEY)!)).toBe("advanced");
    expect(newMapOptionId("nope", "water")).toBeUndefined();
  });
});

/** A menu that records what was added where. */
class FakeMenu implements MenuLike {
  items: string[] = [];
  submenus = new Map<string, FakeMenu>();
  constructor(private withSubmenus = true) {}
  addSeparator(): this {
    this.items.push("---");
    return this;
  }
  addItem(cb: (item: never) => unknown): this {
    let title = "";
    let label = false;
    const item = {
      setTitle: (t: string) => { title = t; return item; },
      setIcon: () => item,
      onClick: () => item,
      setIsLabel: (v: boolean) => { label = v; return item; },
      ...(this.withSubmenus ? { setSubmenu: () => { const m = new FakeMenu(); this.submenus.set(title, m); return m; } } : {}),
    };
    cb(item as never);
    this.items.push(label ? `[${title}]` : title);
    return this;
  }
}

describe("menus: Advanced ▸ and Debug ▸ submenus", () => {
  const map: Record<string, Layer> = { "M.a": "advanced", "M.b": "advanced", "M.d": "debug", "M.h": "hidden" };
  const fill = (layers: MenuLayers) => {
    layers.add("M.main", (i) => i.setTitle("Open"));
    layers.add("M.a", (i) => i.setTitle("Exclude A"));
    layers.add("M.d", (i) => i.setTitle("Raw"));
    layers.add("M.h", (i) => i.setTitle("Gone"));
    layers.add("M.b", (i) => i.setTitle("Exclude B"));
  };

  it("main items stay; Advanced ones go in an Advanced submenu at the end; Debug inside it in debug mode", () => {
    const menu = new FakeMenu();
    const layers = new MenuLayers(menu, true, map);
    fill(layers);
    layers.finish();
    expect(menu.items).toEqual(["Open", "---", "Advanced"]);
    const adv = menu.submenus.get("Advanced")!;
    expect(adv.items).toEqual(["Exclude A", "Exclude B", "Debug"]);
    expect(adv.submenus.get("Debug")!.items).toEqual(["Raw"]);
  });

  it("no Debug submenu while debug mode is off, and nothing hidden is added", () => {
    const menu = new FakeMenu();
    const layers = new MenuLayers(menu, false, map);
    fill(layers);
    layers.finish();
    expect(menu.submenus.get("Advanced")!.items).toEqual(["Exclude A", "Exclude B"]);
    expect(JSON.stringify(menu)).not.toMatch(/Gone|Raw/);
  });

  it("nothing advanced: no separator, no submenu", () => {
    const menu = new FakeMenu();
    const layers = new MenuLayers(menu, true, {});
    layers.add("M.main", (i) => i.setTitle("Open"));
    layers.finish();
    expect(menu.items).toEqual(["Open"]);
  });

  it("without submenus (old Obsidian) the title is a label and the items follow inline", () => {
    const menu = new FakeMenu(false);
    const layers = new MenuLayers(menu, false, map);
    fill(layers);
    layers.finish();
    expect(menu.items).toEqual(["Open", "---", "[Advanced]", "Exclude A", "Exclude B"]);
  });

  it("the map list's and the tables view's context menus use it", () => {
    expect(read("src", "hex-map", "MapModal.ts")).toMatch(/layers\.add\("MapModal\.mapRowContextGenerator"/);
    const rt = read("src", "random-tables", "RandomTableView.ts");
    for (const id of ["folderMenuRollPicker", "folderMenuEncounters", "fileMenuRollPicker", "fileMenuEncounters"]) {
      expect(rt).toMatch(new RegExp(`layers\\.add\\("RTView\\.${id}"`));
    }
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
