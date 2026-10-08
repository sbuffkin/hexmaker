/**
 * The example generator, save and map written for each released version
 * (tests/fixtures/compat/<version>/). Built from a fixed little map so every
 * version's set is comparable. Used by snapshot.ts; read back by
 * tests/compat.test.ts with the current code.
 */

import { cellKey, learnModel, modelToMarkdown, pathRouteKey, solve, type HexWfcModel } from "../../packages/hex-wfc/src";
import { VERSION_KEY } from "../../src/compat";
import { serializeSave } from "../../src/worldgen/saveFormat";
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

export function exampleFiles(version: string): { "generator.md": string; "save.md": string; "map.json": string } {
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
  return { "generator.md": generatorMarkdown, "save.md": save, "map.json": JSON.stringify(map, null, 2) + "\n" };
}
