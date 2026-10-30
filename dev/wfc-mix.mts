// Average terrain mix over several seeds at different sizes vs the example.
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
const ex = new Map<string, string>();
const lakes = [[12, 14, 4], [36, 34, 3.5]], forests = [[38, 10, 5], [10, 38, 4]];
for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
  let t = "Grass";
  for (const [fx, fy, r] of forests) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) t = "Forest";
  if (x > 18 && x < 46 && Math.abs(y - (0.6 * x + 8 + 3 * Math.sin(x / 5))) < 1.1) t = "Ridge";
  for (const [lx, ly, r] of lakes) { const d = Math.hypot(x - lx, y - ly); if (d < r) t = "Water"; else if (d < r + 1.3) t = "Sand"; }
  ex.set(cellKey(x, y), t);
}
const share = (c: Map<string, string>) => { const o: Record<string, number> = {}; for (const t of c.values()) o[t] = (o[t] ?? 0) + 100 / c.size; return o; };
const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k} ${v.toFixed(1)}`).join("  ");
console.log("example ", fmt(share(ex)));
const m = learnModel(ex, { name: "w", orientation: "flat" });
for (const n of [20, 30, 50, 80]) {
  const avg: Record<string, number> = {}; const seeds = [11, 12, 13, 14, 15, 16, 17, 18];
  for (const seed of seeds) { const r = solve(m, { cols: n, rows: n, orientation: "flat", seed, frequencyFeedback: Number(process.argv[2] ?? 2), scatter: Number(process.argv[3] ?? 3) }); if (r.ok) for (const [k, v] of Object.entries(share(r.cells))) avg[k] = (avg[k] ?? 0) + v / seeds.length; }
  console.log(`${n}x${n}`.padEnd(8), fmt(avg));
}
