// Directional bias check: example has ocean along the bottom and forest in the
// top-left. Usage (from WSL): npx tsx dev/wfc-bias.mts [seed]
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
const seed = Number(process.argv[2] ?? 3);
const ex = new Map<string, string>();
for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) {
  const coast = 30 + 2 * Math.sin(x / 4);
  let t = y > coast ? "~" : y > coast - 1.5 ? "s" : "G";
  if (t === "G" && Math.hypot(x - 8, y - 8) < 6) t = "F";
  ex.set(cellKey(x, y), t);
}
const m = learnModel(ex, { name: "coast", orientation: "flat" });
for (const t of m.terrains) console.log(t.name, t.shape, t.layout?.join(" "));
for (const bias of [0, 1]) {
  const r = solve(m, { cols: 30, rows: 16, orientation: "flat", seed, directionalBias: bias });
  if (!r.ok) { console.log(r.message); continue; }
  console.log(`\nbias ${bias}`);
  for (let y = 0; y < 16; y++) { let s = ""; for (let x = 0; x < 30; x++) s += r.cells.get(cellKey(x, y)); console.log(s); }
}
