/**
 * The example generator, save and map written for each released version
 * (tests/fixtures/compat/<version>/). Built from a fixed little map so every
 * version's set is comparable. Used by snapshot.ts; read back by
 * tests/compat.test.ts with the current code.
 */

import { cellKey, learnModel, modelToMarkdown, pathRouteKey, solve, type HexWfcModel } from "../../packages/hex-wfc/src";
import { VERSION_KEY } from "../../src/compat";
import { serializeSave } from "../../src/worldgen/saveFormat";
import { buildMapNote, type HexData } from "../../src/maps/mapNote";
import type { MapData } from "../../src/types";

const COLS = 14, ROWS = 10, SEED = 7;

/** A lake, a forest band and hills, with a road edge to edge and a river into the lake. */
function exampleMap() {
  const cells = new Map<string, string>();
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      const dx = x - 4, dy = y - 5;
      let t = "grass";
      if (dx * dx + dy * dy < 6) t = "shallows";
      else if (x >= 10) t = "forest";
      else if (y <= 1) t = "hills";
      cells.set(cellKey(x, y), t);
    }
  }
  const road = Array.from({ length: COLS }, (_, x) => cellKey(x, 8));
  const river = Array.from({ length: 5 }, (_, i) => cellKey(4, i)).concat(cellKey(4, 5));
  return { cells, paths: [{ type: "Road", hexes: road }, { type: "River", hexes: river }] };
}

export function exampleGenerator(version: string): HexWfcModel {
  const { cells, paths } = exampleMap();
  const model = learnModel(cells, {
    name: "compat-example",
    orientation: "flat",
    paths,
    meta: { palette: "Default", "source-map": "compat-example", created: "2026-10-08", [VERSION_KEY]: version },
  });
  const road = model.paths?.find((p) => p.type === "Road");
  // Exercise every kind of saved setting, so a format change shows up here.
  model.settings = {
    featureSize: 1.25,
    randomness: 0.2,
    edgeSmoothing: 0.5,
    speckSize: 1,
    keepRare: 0.05,
    impassable: ["shallows"],
    connected: true,
    mix: { forest: 1.5 },
    counts: { shallows: { min: 1, max: 2 } },
    drawPaths: true,
    ...(road ? { paths: { [pathRouteKey(road)]: { count: 1, wiggle: 0.5, as: "Road" } } } : {}),
  };
  return model;
}

export function exampleFiles(version: string): { "generator.md": string; "save.md": string; "map.json": string; "map-note.md": string } {
  const model = exampleGenerator(version);
  const generatorMarkdown = modelToMarkdown(model);
  const solved = solve(model, { cols: COLS, rows: ROWS, orientation: "flat", stagger: "odd", seed: SEED });
  if (!solved.ok) throw new Error(`example generator failed: ${solved.message}`);
  const save = serializeSave({
    name: "compat-example-7",
    version,
    format: 1,
    created: "2026-10-08",
    generatorName: model.name,
    generatorPath: "world/generators/compat-example.md",
    palette: "Default",
    seed: SEED,
    cols: COLS,
    rows: ROWS,
    stagger: "odd",
    orientation: "flat",
    settings: model.settings ?? {},
    cells: solved.cells,
    paths: solved.paths,
    generatorMarkdown,
  });
  const map: MapData = {
    name: "compat-example",
    createdWith: version,
    paletteName: "Default",
    gridSize: { cols: COLS, rows: ROWS },
    gridOffset: { x: 0, y: 0 },
    pathChains: solved.paths.map((p) => ({ typeName: p.type, hexes: p.hexes })),
    staggerOffset: "odd",
    showCoords: true,
  };
  return {
    "generator.md": generatorMarkdown,
    "save.md": save,
    "map.json": JSON.stringify(map, null, 2) + "\n",
    "map-note.md": exampleMapNote(version),
  };
}

/**
 * The map note (hexes/<map>/_<map>.md) this version writes for the example
 * map, with every kind of map setting, hex column and path set, so a format
 * change shows up in tests/compat.test.ts.
 */
export function exampleMapNote(version: string): string {
  const { cells, paths } = exampleMap();
  const hexes = new Map<string, HexData>();
  for (const [k, t] of cells) if (t === "shallows") hexes.set(k, { terrain: t });
  hexes.set("3_4", { name: "Glass Wastes", terrain: "hills", icon: "bw-castle.png", gmIcons: ["skull.png", "trap.png"], region: "Basin", submap: "compat-example-3-4", locked: true });
  hexes.set("6_2", { terrain: "grass", extra: { Notes: "a newer build's column" } });
  const settings = {
    displayName: "Compat Example",
    createdWith: version,
    paletteName: "Default",
    gridSize: { cols: COLS, rows: ROWS },
    gridOffset: { x: 0, y: 0 },
    staggerOffset: "odd" as const,
    baseTerrain: "grass",
    terrainType: "forest",
    weatherTable: "world/tables/weather.md",
    showCoords: true,
    showGmLayer: false,
    hiddenLinkBadges: ["Quests"],
    parent: { map: "compat-world", hex: "3_4" },
    world: { id: "w-compat", cx: 1, cy: -1 },
    biome: { generator: "preset-valley", from: ["preset-deep-forest"] },
    backgroundImage: { path: "world/maps/compat example.png", offsetX: 12.5, offsetY: -4, scale: 1.25, rotation: 0, opacity: 0.8 },
    gridDisplayScaleX: 1.0123456789012345,
    gridDisplayOffsetX: -3.3333333333333335,
    // A MapData field this version doesn't know (kept, never dropped).
    originX: 2,
  };
  return buildMapNote("compat-example", {
    settings,
    hexes,
    paths: paths.map((p) => ({ typeName: p.type, hexes: p.hexes })),
  });
}
