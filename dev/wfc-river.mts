// Guaranteed river check: learns from the river example (edge → lake) and
// prints generated maps. Usage (from WSL): npx tsx dev/wfc-river.mts [seed]
import { learnModel, solve, cellKey } from "../packages/hex-wfc/src";
import { riverExample } from "./wfc-learned.mts";
const seed = Number(process.argv[2] ?? 1);
const m = learnModel(riverExample(), { name: "river", orientation: "flat" });
const glyph: Record<string, string> = { Grass: ".", Water: "~", Sand: "s", River: "R" };
for (const [cols, rows] of [[30, 20], [20, 14]]) {
  const r = solve(m, { cols, rows, orientation: "flat", seed });
  if (!r.ok) { console.log(cols, rows, r.message); continue; }
  console.log(`\n${cols}x${rows}`, JSON.stringify(r.stats), r.warnings);
  for (let y = 0; y < rows; y++) { let s = ""; for (let x = 0; x < cols; x++) s += glyph[r.cells.get(cellKey(x, y))!] ?? "?"; console.log(s); }
}
