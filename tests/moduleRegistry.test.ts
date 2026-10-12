import { describe, it } from "node:test";
import expect from "expect";
import { MODULES, registry } from "../src/modules";
import { ModuleRegistry } from "../src/modules/registry";
import type { HexmakerModule } from "../src/modules/types";
import {
  MAP_KINDS,
  contextKindsOf,
  inferredKind,
  isContextOnlyTag,
  kindForChain,
  kindOfTerrains,
  paletteKind,
} from "../src/mapKinds";
import { TERRAIN_TYPES } from "../src/terrainTypes";
import { PALETTE_PRESETS } from "../src/palettes/presets";
import { BUNDLED_ICONS } from "../src/bundledIcons";
import { ICON_PACK_LABELS } from "../src/utils";
import { contextKindsIn, kindForIn, sectionWordsIn, type MapKindHost } from "../src/maps/mapKindQueries";
import { DEFAULT_TERRAIN_PALETTE } from "../src/constants";
import { SPACE_SECTOR_TERRAINS, SPACE_SYSTEM_TERRAINS } from "../src/modules/space/presets";

/**
 * The module registry (plan-code-modules P1) and the one map-type rule
 * (owner call CM3, P2).
 */

const bare = (id: string, extra: Partial<HexmakerModule> = {}): HexmakerModule => ({
  id,
  slice: "X",
  owns: { settingsKeys: [], mapNoteKeys: [], commands: [] },
  ...extra,
});

describe("module registry", () => {
  it("registers world, world-maps and space, in that order", () => {
    expect(MODULES.map((m) => m.id)).toEqual(["world", "world-maps", "space"]);
    expect(registry.kindIds()).toEqual(["world", "space"]);
    // world-maps is a module but not a map type (CM2).
    expect(registry.module("world-maps")?.kind).toBeUndefined();
  });

  it("refuses a module or a map type registered twice", () => {
    expect(() => new ModuleRegistry([bare("a"), bare("a")])).toThrow(/twice/);
    const k = { id: "k", label: "K", description: "" };
    expect(() => new ModuleRegistry([bare("a", { kind: k }), bare("b", { kind: k })])).toThrow(/twice/);
  });

  it("resolves a map type by id or alias, any case", () => {
    expect(registry.kindId("space")).toBe("space");
    expect(registry.kindId(" Planet ")).toBe("space");
    expect(registry.kindId("WORLD")).toBe("world");
    expect(registry.kindId("dungeon")).toBeUndefined();
    expect(registry.kindId(undefined)).toBeUndefined();
  });

  it("has one fallback map type (World), else the first", () => {
    expect(registry.fallbackKind()).toBe("world");
    const r = new ModuleRegistry([bare("s", { kind: { id: "s", label: "S", description: "" } })]);
    expect(r.fallbackKind()).toBe("s");
    expect(new ModuleRegistry([]).fallbackKind()).toBeUndefined();
  });

  it("derives the core's lists from the modules", () => {
    expect(MAP_KINDS.map((k) => k.id)).toEqual(registry.kindIds());
    for (const t of registry.terrainTypes()) expect(TERRAIN_TYPES.some((x) => x.id === t.id && x.kind === t.kind && x.group === t.group)).toBe(true);
    expect(PALETTE_PRESETS.map((p) => p.name)).toEqual(registry.palettes().map((p) => p.name));
    for (const pack of registry.iconPacks()) {
      expect(ICON_PACK_LABELS[pack.id]).toBe(pack.label);
      for (const [file] of pack.icons) expect(BUNDLED_ICONS.has(file)).toBe(true);
    }
    expect(Object.keys(ICON_PACK_LABELS)).toEqual(["terrain", "places", "space", "custom"]);
  });

  it("a module's terrain types say its map type; the core's land and water types don't", () => {
    expect(registry.moduleTypeKind("star")).toBe("space");
    expect(registry.moduleTypeKind("forest")).toBeUndefined();
    expect(registry.moduleTypeKind(undefined)).toBeUndefined();
  });

  it("knows which map types bring engine table roles", () => {
    expect(registry.kindsWithTableRoles()).toEqual(["space"]);
  });

  it("a registry without Space has no space anything", () => {
    const worldOnly = new ModuleRegistry(MODULES.filter((m) => m.id !== "space"));
    expect(worldOnly.kindIds()).toEqual(["world"]);
    expect(worldOnly.terrainTypes()).toEqual([]);
    expect(worldOnly.iconPacks().map((p) => p.id)).toEqual(["places"]);
    expect(worldOnly.palettes().every((p) => p.kind === "world")).toBe(true);
    expect(worldOnly.kindId("planet")).toBeUndefined();
  });

  it("Space alone powers Hexmaker (CM4): its own palettes, a planet surface on shared types", () => {
    const spaceOnly = new ModuleRegistry(MODULES.filter((m) => m.id === "space"));
    expect(spaceOnly.kindIds()).toEqual(["space"]);
    expect(spaceOnly.fallbackKind()).toBe("space");
    expect(spaceOnly.palettes().map((p) => p.name)).toEqual(["Space - Sector", "Space - System", "Space - Planet"]);
  });
});

describe("palette map types", () => {
  it("infers from a module's terrain types only", () => {
    expect(inferredKind(SPACE_SECTOR_TERRAINS)).toBe("space");
    expect(inferredKind(DEFAULT_TERRAIN_PALETTE)).toBeUndefined();
    expect(kindOfTerrains(DEFAULT_TERRAIN_PALETTE)).toBe("world");
    expect(kindOfTerrains([])).toBe("world");
  });

  it("a declared type wins over the terrain types", () => {
    expect(paletteKind({ kind: "world", terrains: SPACE_SECTOR_TERRAINS })).toBe("world");
    expect(paletteKind({ kind: "space", terrains: DEFAULT_TERRAIN_PALETTE })).toBe("space");
    expect(paletteKind({ kind: "bogus", terrains: SPACE_SECTOR_TERRAINS })).toBe("space");
  });

  it("generator tags offered only in their own context", () => {
    expect(isContextOnlyTag("planet")).toBe(true);
    expect(isContextOnlyTag("space")).toBe(false);
    expect(isContextOnlyTag(undefined)).toBe(false);
  });
});

describe("one map-type rule (CM3): the nearest type up the map tree", () => {
  const P = (terrains: { type?: string }[], kind?: string) => ({ terrains, kind });
  const planetLand = P(DEFAULT_TERRAIN_PALETTE); // shared types, nothing declared
  const system = P(SPACE_SYSTEM_TERRAINS, "space");
  const expanded = P(DEFAULT_TERRAIN_PALETTE, "world");

  it("the map's own palette decides when it says a type", () => {
    expect(kindForChain([system])).toBe("space");
    expect(kindForChain([expanded, system])).toBe("world");
    expect(kindForChain([P(SPACE_SECTOR_TERRAINS), expanded])).toBe("space");
  });

  it("a palette of only shared types says nothing: the parent decides", () => {
    expect(kindForChain([planetLand, system])).toBe("space");
    expect(kindForChain([planetLand])).toBeUndefined();
    expect(kindForChain([P([{ name: "red" } as { type?: string }]), planetLand, expanded])).toBe("world");
  });

  it("edge case: a palette declared world that holds space types is world", () => {
    // Before CM3, the section words said space here while the generators
    // said world; now every question gets the same answer.
    const edge = P([{ type: "void" }, { type: "forest" }], "world");
    expect(kindForChain([edge])).toBe("world");
    expect(kindForChain([planetLand, edge])).toBe("world");
    // ...but generator context still sees each palette's own type.
    expect([...contextKindsOf([edge])]).toEqual(["world"]);
  });

  it("context is every palette's type along the chain", () => {
    expect([...contextKindsOf([planetLand, system])].sort()).toEqual(["space", "world"]);
    expect([...contextKindsOf([undefined, expanded])]).toEqual(["world"]);
  });

  it("the plugin asks the same rule through the map tree", () => {
    const maps: Record<string, { paletteName: string; parent?: string }> = {
      sector: { paletteName: "Space - Sector" },
      surface: { paletteName: "Expanded", parent: "sector" },
      moonbase: { paletteName: "Land", parent: "sector" },
      edge: { paletteName: "Edge" },
    };
    const palettes: Record<string, { kind?: string; terrains: { name: string; color: string; type?: string }[] }> = {
      Land: { terrains: [{ name: "plain", color: "#000", type: "grassland" }] },
      Edge: { kind: "world", terrains: [{ name: "void", color: "#000", type: "void" }] },
    };
    const host: MapKindHost = {
      getMap: (m) => maps[m],
      parentOf: (m) => (maps[m]?.parent ? { map: maps[m].parent! } : undefined),
      getPaletteByName: (n) => palettes[n],
    };
    expect(kindForIn(host, "sector")).toBe("space");
    expect(kindForIn(host, "surface")).toBe("world"); // presets declare their type
    expect(kindForIn(host, "moonbase")).toBe("space");
    expect(kindForIn(host, "edge")).toBe("world");
    expect(kindForIn(host, "nowhere")).toBeUndefined();
    expect(contextKindsIn(host, "surface").has("space")).toBe(true);
    expect(sectionWordsIn(host, "moonbase")("Towns").label).toBe("Settlements");
    expect(sectionWordsIn(host, "edge")("Towns").label).toBe("Towns");
    expect(sectionWordsIn(host, undefined)("Towns").label).toBe("Towns");
  });
});

describe("generators, engines and table roles through modules (P3)", () => {
  it("every table role rolls on an engine of its own module", () => {
    for (const m of MODULES) {
      const engines = new Set((m.engines ?? []).map((e) => e.id));
      for (const r of m.tableRoles ?? []) expect({ role: r.id, ok: engines.has(r.engine) }).toEqual({ role: r.id, ok: true });
    }
    expect(registry.engines().map((e) => e.id)).toEqual(["procedural:star-scatter", "procedural:orbits"]);
  });

  it("the modules' built-in generators keep the list order", async () => {
    const { moduleGenerators, MODULE_RUNTIMES } = await import("../src/modules/runtime");
    expect(MODULE_RUNTIMES.map((r) => r.id)).toEqual(MODULES.map((m) => m.id));
    const plugin = { settings: { hexOrientation: "flat" } } as never;
    const gens = moduleGenerators(plugin, { toPaths: () => ({ paths: [], missing: [] }), procGrid: (g) => ({ ...g, orientation: "flat" }) });
    expect(gens.map((g) => g.id)).toEqual([
      "procedural:star-scatter", "procedural:orbits", "procedural:region-detail",
      "procedural:overland", "procedural:world-biomes", "procedural:planet-surface",
    ]);
    // Each generator is tagged with a map type a module provides.
    for (const g of gens) expect(registry.kindIds()).toContain(g.mapKind);
  });

  it("first-map generators and background terrains come from the map types", () => {
    expect(registry.kindInfo("world")?.firstGenerators).toEqual(["procedural:overland"]);
    expect(registry.kindInfo("space")?.firstGenerators).toEqual(["procedural:star-scatter"]);
    expect(registry.kindInfo("space")?.baseTerrainTypes).toEqual(["void"]);
  });

  it("path roles and When keys come from the modules", async () => {
    const { conditionKeys, parseWhen, formatWhen } = await import("../src/random-tables/tableConditions");
    expect(registry.pathRoles()).toEqual({ routes: "Path type for routes", orbits: "Path type for orbits" });
    expect(conditionKeys()).toEqual(["temperature", "zone", "ring", "star", "type", "terrain"]);
    // Aliases read as the module's key.
    expect(formatWhen(parseWhen("orbit: outer; distance: 2-3; temp: cold"))).toBe("zone: outer; ring: 2–3; temperature: 0–0.2");
  });
});

describe("stores, settings, commands and one-time upgrades through modules (P4)", () => {
  it("Space brings the World types store, folder setting, two commands and its seeding", async () => {
    const { MODULE_RUNTIMES, moduleCommands, moduleFolderSettings } = await import("../src/modules/runtime");
    const space = MODULE_RUNTIMES.find((r) => r.id === "space")!;
    expect(moduleCommands().map((c) => [c.command.id, c.kind ?? null])).toEqual([
      ["new-overworld", null], // World maps (P7): works with any map type
      ["edit-world-types", "space"], // only while Space is on
      ["convert-world-types", null], // whenever there's something to convert
    ]);
    expect(moduleFolderSettings().map((d) => [d.id, d.key])).toEqual([
      ["Settings.biomesFolder", "biomesFolder"],
      ["Settings.biomePoolsFolder", "biomePoolsFolder"],
      ["Settings.worldTypesFolder", "worldTypesFolder"],
    ]);
    expect(typeof space.stores).toBe("function");
    expect(typeof space.onEnabled).toBe("function");
    // Every command and setting key a module adds is one it says it owns.
    for (const r of MODULE_RUNTIMES) {
      const owns = registry.module(r.id)!.owns;
      for (const c of r.commands ?? []) expect(owns.commands).toContain(c.id);
      for (const d of r.folderSettings ?? []) expect(owns.settingsKeys).toContain(d.key);
    }
  });

  it("a module's folder setting has a place in the placement map", async () => {
    const { PLACEMENT } = await import("../src/ui/placement");
    const { moduleFolderSettings } = await import("../src/modules/runtime");
    for (const d of moduleFolderSettings()) expect(PLACEMENT[d.id]).toBeDefined();
  });

  it("onEnabled runs only for the map types just turned on, in module order", async () => {
    const { runOnEnabled } = await import("../src/modules/runtime");
    const calls: string[] = [];
    const plugin = {
      worldTypeStore: { ensureDefault: async () => { calls.push("world types"); } },
      installShippedTables: async (kinds: string[]) => { calls.push(`tables ${kinds.join(",")}`); return []; },
    } as never;
    await runOnEnabled(plugin, ["world"]);
    expect(calls).toEqual([]);
    await runOnEnabled(plugin, ["world", "space"]);
    expect(calls).toEqual(["world types", "tables space"]);
  });

  it("the one-time terrain type refinement comes from the modules", async () => {
    const { refinedTerrainType } = await import("../src/terrainTypes");
    expect(refinedTerrainType({ name: "moon", type: "world" })).toBe("moon");
    expect(refinedTerrainType({ name: "moon", type: "desert" })).toBeUndefined();
    expect(registry.terrainTypeRefinements()).toHaveLength(1);
  });
});
