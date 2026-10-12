import { describe, it } from "node:test";
import expect from "expect";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TFile } from "obsidian";
import type HexmakerPlugin from "../src/HexmakerPlugin";
import { contextKindsIn, kindForIn, sectionWordsIn, type MapKindHost } from "../src/maps/mapKindQueries";
import {
  MAP_KINDS,
  generatorMapKind,
  isGeneratorShown,
  isIconHiddenByKind,
  inferredKind,
  paletteKind,
  resolveMapKinds,
  terrainsForTables,
} from "../src/mapKinds";
import { TERRAIN_GROUPS, TERRAIN_TYPES, inferTerrainType, normalizeTerrainType } from "../src/terrainTypes";
import { refinedSpaceType } from "../src/modules/space/terrainTypes";
import { PALETTE_PRESETS, getPreset } from "../src/palettes/presets";
import { BUNDLED_ICONS } from "../src/bundledIcons";
import { ICON_PACK_LABELS, defaultIconPack, iconLabel, iconPack, iconPackTabs, sortIcons } from "../src/utils";
import { planKindContent } from "../src/kindContent";
import { childKindText } from "../src/hex-map/newChildMap";
import {
  firstMapGenerator,
  listGeneratorKinds,
  newMapGeneratorChoices,
  runGenerator,
  suggestBaseTerrain,
  visibleKinds,
  type TerrainGeneratorKind,
} from "../src/worldgen/registry";
import { ENGINE_ROLES } from "../src/worldgen/tableRoles";
import { defaultPathTypeFor } from "../src/worldgen/generatorPathTypes";
import { moonPlanetLinks } from "../src/space/moonLinks";
import type { MapData, TerrainColor, TerrainPalette } from "../src/types";

/**
 * Characterisation snapshot for the module refactor (plan-code-modules
 * P0): what the core answers today about map types, over a matrix of
 * {map types on} × {palette kinds} × {map trees}. Every phase of the
 * refactor must leave this unchanged, except where an owner call changes
 * it on purpose (CM3: one map-type rule; see the "kindFor" entries).
 *
 * UPDATE_SNAPSHOT=1 rewrites tests/fixtures/moduleCharacterisation.json.
 */

const SNAP = new URL("./fixtures/moduleCharacterisation.json", import.meta.url);

// ── Palettes ────────────────────────────────────────────────────────────
const custom = (name: string, terrains: TerrainColor[], kind?: string): TerrainPalette =>
  ({ name, terrains, ...(kind ? { kind } : {}) }) as TerrainPalette;
const T = (name: string, type?: string): TerrainColor => ({ name, color: "#000", ...(type ? { type } : {}) });

const CUSTOM: TerrainPalette[] = [
  custom("Custom space", [T("nothing", "void"), T("sun", "star"), T("rock", "world")]),
  custom("Custom plain", [T("red"), T("blue")]),
  custom("Custom land", [T("woods", "forest"), T("sea", "water")]),
  // The CM3 edge case: declared world, holding space types.
  custom("Edge", [T("nothing", "void"), T("woods", "forest")], "world"),
];
const PRESET_NAMES = PALETTE_PRESETS.map((p) => p.name);
const ALL_PALETTES = [...PRESET_NAMES, ...CUSTOM.map((p) => p.name)];

// ── Map trees ───────────────────────────────────────────────────────────
// [name, palette, parent]
const TREE: [string, string, string | undefined][] = [
  ["sector", "Space - Sector", undefined],
  ["system", "Space - System", "sector"],
  ["planet", "Space - Planet", "system"],
  ["world", "Expanded", undefined],
  ["region", "Expanded", "world"],
  ["surface-on-system", "Expanded", "system"],
  ["custom-space", "Custom space", undefined],
  ["custom-space-in-world", "Custom space", "world"],
  ["plain", "Custom plain", undefined],
  ["plain-in-sector", "Custom plain", "sector"],
  ["land", "Custom land", undefined],
  ["land-in-system", "Custom land", "system"],
  ["edge", "Edge", undefined],
  ["edge-child", "Custom plain", "edge"],
  ["limited-under-edge", "Limited", "edge"],
];

const KIND_SETS: (string[] | undefined)[] = [["world"], ["space"], ["world", "space"], [], undefined];
const ks = (k: string[] | undefined) => (k === undefined ? "unset" : k.length ? k.join("+") : "none");

/** A plugin with just enough state for the map-type questions. */
function fakePlugin(mapKinds: string[] | undefined): HexmakerPlugin & MapKindHost {
  const maps: MapData[] = TREE.map(([name, paletteName, parent]) => ({
    name,
    paletteName,
    gridSize: { cols: 4, rows: 4 },
    gridOffset: { x: 0, y: 0 },
    pathChains: [],
    ...(parent ? { parent: { map: parent, hex: "1_1" } } : {}),
  })) as MapData[];
  const terrainPalettes = [...PALETTE_PRESETS.map((p) => ({ name: p.name, terrains: p.terrains, kind: p.kind })), ...CUSTOM];
  return {
    settings: { maps, terrainPalettes, worldFolder: "world", pathTypes: [], hexOrientation: "flat", ...(mapKinds ? { mapKinds } : {}) },
    app: { vault: { getMarkdownFiles: () => [] as TFile[], cachedRead: async () => "" } },
    getMap: (m: string) => maps.find((x) => x.name === m),
    parentOf: (m: string) => {
      const par = maps.find((x) => x.name === m)?.parent;
      return par ? { map: par.map, hex: par.hex } : undefined;
    },
    getPaletteByName: (n: string) => terrainPalettes.find((p) => p.name === n),
  } as unknown as HexmakerPlugin & MapKindHost;
}

const palTerrains = (name: string): TerrainColor[] =>
  getPreset(name)?.terrains ?? CUSTOM.find((p) => p.name === name)?.terrains ?? [];
const palObj = (name: string) => getPreset(name) ?? CUSTOM.find((p) => p.name === name);

async function collect(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // Static registries.
  out.mapKinds = MAP_KINDS.map((k) => ({ id: k.id, label: k.label, description: k.description, iconPrefix: k.iconPrefix, sectionWords: k.sectionWords }));
  out.terrainGroups = TERRAIN_GROUPS;
  out.terrainTypes = TERRAIN_TYPES.map((t) => `${t.id}|${t.kind}|${t.group}|${t.label}|${t.keywords.join(",")}`);
  out.presets = PALETTE_PRESETS.map((p) => ({
    name: p.name,
    kind: p.kind,
    terrains: p.terrains.map((t) => `${t.name}|${t.type ?? ""}|${t.color}|${t.icon ?? ""}`),
    pathTypes: (p.pathTypes ?? []).map((t) => t.name),
    childPalette: p.childPalette,
    pathRoles: p.pathRoles,
    submapDefaults: p.submapDefaults,
  }));
  out.bundledIcons = [...BUNDLED_ICONS.keys()];
  out.iconPackLabels = ICON_PACK_LABELS;
  const sampleIcons = ["bw-forest.png", "place-castle.svg", "space-sun.svg", "my-own.png", ...[...BUNDLED_ICONS.keys()].filter((_, i) => i % 9 === 0)];
  out.iconPack = Object.fromEntries(sampleIcons.map((i) => [i, iconPack(i, new Set(["my-own.png"]))]));
  out.iconLabel = Object.fromEntries(sampleIcons.map((i) => [i, iconLabel(i)]));
  out.sortIcons = sortIcons([...BUNDLED_ICONS.keys()].reverse());
  out.iconPackTabs = iconPackTabs(new Map([["terrain", 3], ["places", 2], ["space", 0]] as [never, number][]));
  out.generatorMapKind = Object.fromEntries(["planet", "space", " Planet ", "world", "dungeon", ""].map((v) => [v || "(blank)", generatorMapKind({ "map-kind": v }) ?? null]));
  out.paletteKind = Object.fromEntries(ALL_PALETTES.map((n) => [n, paletteKind(palObj(n))]));
  out.isSpacePalette = Object.fromEntries(ALL_PALETTES.map((n) => [n, inferredKind(palTerrains(n)) === "space"]));
  out.suggestBaseTerrain = Object.fromEntries(ALL_PALETTES.map((n) => [n, suggestBaseTerrain(palTerrains(n)) ?? null]));
  out.refinedSpaceType = ["moon|world", "Luna satellite|world", "comet|asteroids", "wreck|asteroids", "jump gate|station", "starport|station", "jump limit|void", "star system|star", "forest|forest"]
    .map((s) => { const [name, type] = s.split("|"); return `${s} -> ${refinedSpaceType({ name, type }) ?? ""}`; });
  out.inferTerrainType = ["dark forest", "gas giant", "ice moon", "black lake", "planet", "red dwarf", "salt flat"]
    .flatMap((n) => [undefined, "world", "space"].map((k) => `${n}|${k ?? ""} -> ${inferTerrainType(n, undefined, k as never) ?? ""}`));
  out.normalizeTerrainType = ["Deep-Water", "snow", "Void / empty space", "gas giant", "nope"].map((v) => `${v} -> ${normalizeTerrainType(v) ?? ""}`);
  out.engineRoles = ENGINE_ROLES.map((r) => `${r.id}|${r.engine}|${r.name}|${r.terrainTypes.join(",")}`);
  out.defaultPathTypeFor = {
    routes: defaultPathTypeFor("routes", [{ name: "Jump route" }, { name: "Road" }]) ?? null,
    orbits: defaultPathTypeFor("orbits", [{ name: "Orbit" }]) ?? null,
    none: defaultPathTypeFor("routes", [{ name: "Road" }]) ?? null,
  };
  out.childKindText = { space: childKindText("space"), other: childKindText(undefined) };
  out.moonLinks = moonPlanetLinks(
    new Map([["1_1", "moon"], ["2_1", "terrestrial planet"], ["1_2", "gas giant"], ["3_3", "moon"]]),
    getPreset("Space - System")!.terrains, "flat", "odd");

  // Per map-types setting.
  const perKinds: Record<string, unknown> = {};
  for (const kinds of KIND_SETS) {
    const s = kinds === undefined ? {} : { mapKinds: kinds };
    const plugin = fakePlugin(kinds);
    const gens = await listGeneratorKinds(plugin);
    const row: Record<string, unknown> = {};
    row.resolveMapKinds = resolveMapKinds(kinds, []);
    row.defaultIconPack = defaultIconPack(s);
    row.iconHidden = sampleIcons.filter((i) => isIconHiddenByKind(s, i));
    row.terrainsForTables = terrainsForTables(
      ALL_PALETTES.map((n) => ({ name: n, kind: palObj(n)?.kind, terrains: palTerrains(n) })),
      kinds ?? ["world", "space"],
      ["Custom plain"],
    ).map((t) => t.name);
    row.generatorShown = Object.fromEntries(["world", "space", undefined].flatMap((k) => [false, true].map((ctx) =>
      [`${k ?? "none"}|ctx=${ctx}`, isGeneratorShown(s, k as never, { context: new Set(ctx ? ["space"] : []) })])));
    row.visible = {
      noContext: visibleKinds(gens, s, new Set()).map((g) => g.id),
      spaceContext: visibleKinds(gens, s, new Set(["space"])).map((g) => g.id),
      selectedPlanet: visibleKinds(gens, s, new Set(), "procedural:planet-surface").map((g) => g.id),
    };
    row.newMapChoices = Object.fromEntries(ALL_PALETTES.map((n) => [n, newMapGeneratorChoices(gens, s, palTerrains(n), undefined, false).map((g) => g.id)]));
    row.firstMapGenerator = Object.fromEntries(ALL_PALETTES.map((n) => {
      const fitting = gens.filter((g) => g.fits(palTerrains(n)));
      return [n, firstMapGenerator(fitting, kinds ?? [])];
    }));
    row.planKindContent = planKindContent({
      kinds: (kinds ?? ["world", "space"]) as never,
      done: ["world"],
      firstSetup: true,
      palettes: PALETTE_PRESETS.map((p) => ({ name: p.name, kind: p.kind, terrains: p.terrains })),
      inUse: new Set(["Expanded"]),
      defaultPalette: "Expanded",
    });
    row.isSpaceMap = Object.fromEntries(TREE.map(([m]) => [m, contextKindsIn(plugin, m).has("space")]));
    perKinds[ks(kinds)] = row;
  }
  out.perKinds = perKinds;

  // Section words per map (independent of the setting).
  const plugin = fakePlugin(["world", "space"]);
  out.sectionWords = Object.fromEntries(TREE.map(([m]) => {
    const w = sectionWordsIn(plugin, m);
    return [m, ["Towns", "Dungeons", "Features", "Quests", "Factions"].map((s) => w(s).label).join(",")];
  }));

  // CM3: one map-type rule (P2). Not in today's code before P2.
  out.kindFor = Object.fromEntries(TREE.map(([m]) => [m, kindForIn(plugin, m) ?? null]));

  // runGenerator: context paths carried over (not on space palettes).
  const fake: TerrainGeneratorKind = {
    id: "fake", label: "fake", description: "", source: "built-in", options: [], fits: () => true,
    generate: (req) => ({ ok: true, cells: new Map([...Array(16).keys()].map((i) => [`${i % 4}_${Math.floor(i / 4)}`, req.terrains[0].name])), paths: [], warnings: [] }),
    toPaths: () => ({ paths: [], missing: [] }),
  };
  out.runGeneratorCarry = Object.fromEntries(ALL_PALETTES.map((n) => {
    const terrains = palTerrains(n);
    if (!terrains.length) return [n, null];
    const r = runGenerator("flat", fake, {
      terrains,
      grid: { cols: 4, rows: 4, offset: { x: 0, y: 0 }, stagger: "odd" },
      seed: 1,
      options: {},
      context: { paths: [{ type: "Road", from: "W", to: "E" }] },
    });
    return [n, r.ok ? r.paths.length : `fail:${r.message}`];
  }));
  return out;
}

describe("module refactor characterisation (P0)", () => {
  it("answers exactly as recorded", async () => {
    const now = JSON.parse(JSON.stringify(await collect())) as Record<string, unknown>;
    if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(SNAP)) {
      writeFileSync(SNAP, JSON.stringify(now, null, 2) + "\n");
    }
    const recorded = JSON.parse(readFileSync(SNAP, "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(recorded)) expect({ [key]: now[key] }).toEqual({ [key]: recorded[key] });
    expect(Object.keys(now).sort()).toEqual(Object.keys(recorded).sort());
  });
});
