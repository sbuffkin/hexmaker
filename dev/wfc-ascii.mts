// Prints generated maps as ASCII for eyeballing hex-wfc output.
// Usage (from WSL): npx tsx dev/wfc-ascii.mts [seed] [flat|pointy] [featureSize]
// Learns from a 50×50 example (lakes ringed by sand, a mountain ridge, forest
// patches on grass), then generates 20×20 and 50×50 maps.
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
const seed = Number(process.argv[2] ?? 5);
const o = (process.argv[3] ?? "flat") as "flat" | "pointy";
const featureSize = Number(process.argv[4] ?? 1);

const ex = new Map<string, string>();
const lakes = [[12, 14, 4], [36, 34, 3.5]];
const forests = [[38, 10, 5], [10, 38, 4]];
for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
  let t = "G";
  for (const [fx, fy, r] of forests) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) t = "F";
  // Ridge: a 2-wide diagonal-ish band
  const ridgeY = 0.6 * x + 8 + 3 * Math.sin(x / 5);
  if (x > 18 && x < 46 && Math.abs(y - ridgeY) < 1.1) t = "^";
  for (const [lx, ly, r] of lakes) {
    const d = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2);
    if (d < r) t = "~"; else if (d < r + 1.3) t = "s";
  }
  ex.set(cellKey(x, y), t);
}
const m = learnModel(ex, { name: "example", orientation: o });
console.log(m.terrains.map((t) => `${t.name}: w${t.weight} patch ${(t.patch! * 100).toFixed(1)}% ${t.shape}${t.turn ? " turn " + t.turn : ""}`).join("\n"));
const share = (cells: Map<string, string>) => {
  const c: Record<string, number> = {};
  for (const t of cells.values()) c[t] = (c[t] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${k} ${((100 * v) / cells.size).toFixed(0)}%`).join(" ");
};
console.log("example mix:", share(ex));
const show = (cells: Map<string, string>, cols: number, rows: number) => {
  for (let y = 0; y < rows; y++) { let s = ""; for (let x = 0; x < cols; x++) s += cells.get(cellKey(x, y)); console.log(s); }
};
for (const [cols, rows] of [[20, 20], [50, 30]]) {
  const r = solve(m, { cols, rows, orientation: o, seed, featureSize });
  if (!r.ok) { console.log(cols, rows, r.message); continue; }
  console.log(`\n${cols}x${rows}`, share(r.cells), JSON.stringify(r.stats));
  show(r.cells, cols, rows);
}
