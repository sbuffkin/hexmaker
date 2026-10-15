// How faithfully generators learned from real vault maps reproduce them, for
// two copies of the hex-wfc library (e.g. before and after a change). Read-only.
//   npx tsx dev/wfc-learn-compare.mts <old-lib-dir> <map-name>... (env SEEDS; PLUGIN_DIR = folder with data.json)
// layout-err: mean gap between where each terrain sits in the source map and
//   in generated maps, on a 5×5 grid (lower is closer).
// near-held: of the source map's near rules ("lava within 2 of volcano"),
//   the share of generated hexes that keep them (the source map is 100%).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as cur from "../packages/hex-wfc/src";

const [oldDir, ...names] = process.argv.slice(2);
const old = await import(pathToFileURL(`${oldDir}/index.ts`).href);
const seeds = Number(process.env.SEEDS ?? 6);
const pluginDir = process.env.PLUGIN_DIR ?? (existsSync("data.json") ? "." : join(process.cwd(), "../../../.obsidian/plugins/duckmage-plugin"));
const data = JSON.parse(readFileSync(join(pluginDir, "data.json"), "utf8"));
const vaultRoot = join(pluginDir, "../../..");

function load(name: string) {
  const map = data.maps.find((m: { name: string }) => m.name === name);
  if (!map) throw new Error(`no map ${name}`);
  const cells = new Map<string, string>();
  for (let x = map.gridOffset.x; x < map.gridOffset.x + map.gridSize.cols; x++)
    for (let y = map.gridOffset.y; y < map.gridOffset.y + map.gridSize.rows; y++) {
      const f = join(vaultRoot, data.hexFolder, name, `${x}_${y}.md`);
      if (!existsSync(f)) continue;
      const t = /^---[\s\S]*?\nterrain:\s*(.*)\n/.exec(readFileSync(f, "utf8"))?.[1].trim().replace(/^"|"$/g, "");
      if (t) cells.set(cur.cellKey(x, y), t);
    }
  return { map, cells };
}

/** Share of each terrain in each cell of a 5×5 grid over the map. */
function grid5(cells: Map<string, string>): Map<string, number[]> {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k of cells.keys()) {
    const [x, y] = cur.parseCellKey(k)!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = new Map<string, number[]>();
  for (const [k, t] of cells) {
    const [x, y] = cur.parseCellKey(k)!;
    const b = Math.min(4, Math.floor((5 * (y - minY)) / h)) * 5 + Math.min(4, Math.floor((5 * (x - minX)) / w));
    let a = out.get(t);
    if (!a) out.set(t, (a = new Array(25).fill(0)));
    a[b] += 1 / cells.size;
  }
  return out;
}

function nearHeld(cells: Map<string, string>, rules: Map<string, { terrain: string; distance: number }>, o: cur.Orientation, s: cur.Stagger) {
  let ok = 0, all = 0;
  for (const [t, r] of rules) {
    const anchors = [...cells].filter(([, u]) => u === r.terrain).map(([k]) => cur.parseCellKey(k)!);
    for (const [k, u] of cells) {
      if (u !== t) continue;
      all++;
      const xy = cur.parseCellKey(k)!;
      if (anchors.some((a) => cur.hexDistance(xy, a, o, s) <= r.distance)) ok++;
    }
  }
  return all ? ok / all : NaN;
}

for (const name of names) {
  const { map, cells } = load(name);
  const orientation = data.hexOrientation ?? "flat";
  const stagger = map.staggerOffset ?? data.staggerOffset ?? "odd";
  const src = grid5(cells);
  const rules = cur.measureNear(cells, orientation, stagger);
  const row: string[] = [];
  for (const [label, lib] of [["old", old], ["new", cur]] as const) {
    const model = lib.learnModel(cells, { name, orientation, stagger });
    let err = 0, held = 0, n = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = lib.solve(model, { cols: map.gridSize.cols, rows: map.gridSize.rows, orientation, stagger, seed });
      if (!r.ok) continue;
      const gen = grid5(r.cells);
      for (const t of new Set([...src.keys(), ...gen.keys()])) {
        const a = src.get(t) ?? new Array(25).fill(0), b = gen.get(t) ?? new Array(25).fill(0);
        for (let i = 0; i < 25; i++) err += Math.abs(a[i] - b[i]);
      }
      held += nearHeld(r.cells, rules, orientation, stagger) || 0;
      n++;
    }
    row.push(`${label}: layout-err ${(err / Math.max(1, n)).toFixed(3)} near-held ${rules.size ? ((100 * held) / Math.max(1, n)).toFixed(0) + "%" : " –"}`);
  }
  console.log(`${name.padEnd(14)} ${String(cells.size).padStart(5)} hexes, ${String(rules.size).padStart(2)} near rules | ${row.join(" | ")}`);
}
