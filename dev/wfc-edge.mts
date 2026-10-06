// Border check: compare the share of each terrain on the outer 2 rings in a
// real vault map vs generated maps (learned edge, "as in the example").
// Usage (from WSL, plugin root): npx tsx <worktree>/dev/wfc-edge.mts <map> [edgeStrength]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
const data = JSON.parse(readFileSync("data.json", "utf8"));
const name = process.argv[2] ?? "the-coast";
const strength = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const map = data.maps.find((m: { name: string }) => m.name === name);
const cells = new Map<string, string>();
for (let x = map.gridOffset.x; x < map.gridOffset.x + map.gridSize.cols; x++)
  for (let y = map.gridOffset.y; y < map.gridOffset.y + map.gridSize.rows; y++) {
    const f = join("../../..", data.hexFolder, name, `${x}_${y}.md`);
    if (!existsSync(f)) continue;
    const m = /^---[\s\S]*?\nterrain:\s*(.*)\n/.exec(readFileSync(f, "utf8"));
    const t = m?.[1].trim().replace(/^"|"$/g, "");
    if (t) cells.set(cellKey(x, y), t);
  }
const { cols, rows } = map.gridSize, ox = map.gridOffset.x, oy = map.gridOffset.y;
const ringShare = (c: Map<string, string>, x0: number, y0: number) => {
  const out: Record<string, number> = {}; let n = 0;
  for (const [k, t] of c) { const [x, y] = k.split("_").map(Number); const d = Math.min(x - x0, x0 + cols - 1 - x, y - y0, y0 + rows - 1 - y); if (d <= 1) { out[t] = (out[t] ?? 0) + 1; n++; } }
  for (const t in out) out[t] = Math.round((1000 * out[t]) / n) / 10;
  return out;
};
const model = learnModel(cells, { name, orientation: data.hexOrientation, stagger: map.staggerOffset ?? "odd" });
const ex = ringShare(cells, ox, oy);
const gen: Record<string, number> = {};
const seeds = [1, 2, 3, 4, 5, 6];
for (const seed of seeds) {
  const r = solve(model, { cols, rows, orientation: data.hexOrientation, stagger: map.staggerOffset ?? "odd", seed, features: false, ...(strength === undefined ? {} : { edgeStrength: strength }) });
  if (!r.ok) continue;
  for (const [t, v] of Object.entries(ringShare(r.cells, 0, 0))) gen[t] = (gen[t] ?? 0) + v / seeds.length;
}
const top = Object.entries(ex).sort((a, b) => b[1] - a[1]).slice(0, 8);
let err = 0;
for (const t of new Set([...Object.keys(ex), ...Object.keys(gen)])) err += Math.abs((ex[t] ?? 0) - (gen[t] ?? 0));
console.log(`edge strength ${strength ?? "default"}: border mismatch ${err.toFixed(0)} pts`);
for (const [t, v] of top) console.log(" ", t.padEnd(20), `example ${v.toFixed(1)}%`.padEnd(16), `generated ${(gen[t] ?? 0).toFixed(1)}%`);
