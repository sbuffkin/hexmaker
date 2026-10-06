// Prints a generated map as ASCII for eyeballing hex-wfc output.
// Usage (from WSL): npx tsx dev/wfc-ascii.mts [seed] [flat|pointy]
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
const seed = Number(process.argv[2] ?? 5);
const o = (process.argv[3] ?? "flat") as "flat" | "pointy";
const ex = new Map<string, string>();
for (let x = 0; x < 20; x++) for (let y = 0; y < 16; y++) {
  const dx = x - 6, dy = y - 7; let t = "G";
  if (dx*dx+dy*dy < 12) t = "~"; else if (dx*dx+dy*dy < 22) t = "s"; else if (x >= 14) t = "F";
  ex.set(cellKey(x, y), t);
}
const m = learnModel(ex, { name: "example", orientation: o });
const r = solve(m, { cols: 50, rows: 18, orientation: o, seed });
if (!r.ok) { console.log(r.message); process.exit(); }
const counts: Record<string, number> = {};
for (const t of r.cells.values()) counts[t] = (counts[t] ?? 0) + 1;
console.log("seed", seed, o, JSON.stringify(counts), JSON.stringify(r.stats));
for (let y = 0; y < 18; y++) { let s = ""; for (let x = 0; x < 50; x++) s += r.cells.get(cellKey(x, y)); console.log(s); }
