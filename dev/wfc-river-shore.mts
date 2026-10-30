// How much generated paths hug water: share of path hexes next to a water
// hex, and share on water, over many seeds of a vault generator. Read-only.
// Usage (from WSL, plugin root):
//   VAULT=/mnt/c/.../journal npx tsx dev/wfc-river-shore.mts <generator> [type] [seeds]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelMarkdown, solve, hexNeighbors, cellKey, parseCellKey } from "../packages/hex-wfc/src";

const vault = process.env.VAULT ?? join(process.cwd(), "../../../..");
const data = JSON.parse(readFileSync(join(vault, ".obsidian/plugins/duckmage-plugin/data.json"), "utf8"));
const world = String(data.worldFolder ?? "").replace(/^\/+|\/+$/g, "");
const name = process.argv[2] ?? "bay-area-and-the-coast";
const type = process.argv[3] ?? "River";
const seeds = Number(process.argv[4] ?? 20);
const parsed = parseModelMarkdown(readFileSync(join(vault, world, "generators", `${name}.md`), "utf8"));
const model = "model" in parsed ? parsed.model : (parsed as never);
const water = new Set(["shallows", "ocean", "trench", "water"]);
const orientation = data.hexOrientation ?? "flat", stagger = data.staggerOffset ?? "odd";
let hexes = 0, nearWater = 0, onWater = 0, paths = 0, land = 0, landNearWater = 0;
// IMPASSABLE=none routes without blocking water (to compare).
const impassable = process.env.IMPASSABLE === "none" ? [] : [...water];
for (let seed = 1; seed <= seeds; seed++) {
  const r = solve(model, { cols: 38, rows: 25, orientation, stagger, seed, impassable });
  if (!r.ok) continue;
  for (const [h, t] of r.cells) {
    if (water.has(t)) continue;
    land++;
    const [x, y] = parseCellKey(h)!;
    if (hexNeighbors(x, y, orientation, stagger).some(([nx, ny]) => water.has(r.cells.get(cellKey(nx, ny)) ?? ""))) landNearWater++;
  }
  for (const p of r.paths.filter((p) => p.type === type)) {
    paths++;
    for (const h of p.hexes) {
      const [x, y] = parseCellKey(h)!;
      hexes++;
      if (water.has(r.cells.get(h) ?? "")) onWater++;
      else if (hexNeighbors(x, y, orientation, stagger).some(([nx, ny]) => water.has(r.cells.get(cellKey(nx, ny)) ?? ""))) nearWater++;
    }
  }
}
console.log(`${name} ${type}: ${paths} paths, ${hexes} hexes; next to water ${(100 * nearWater / hexes).toFixed(1)}%, on water ${(100 * onWater / hexes).toFixed(1)}%, avg length ${(hexes / paths).toFixed(1)}; land next to water overall ${(100 * landNearWater / land).toFixed(1)}%`);
