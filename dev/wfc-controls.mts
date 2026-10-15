// Eyeball check for solver controls on the world example.
// Usage (from WSL): npx tsx dev/wfc-controls.mts
import { learnModel, solve, cellKey, countPatches, type SolveOptions } from "../packages/hex-wfc/src";
const world = new Map<string, string>();
const lakes = [[12, 14, 4], [36, 34, 3.5]], forests = [[38, 10, 5], [10, 38, 4]];
for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
  let t = "Grass";
  for (const [fx, fy, r] of forests) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) t = "Forest";
  if (x > 18 && x < 46 && Math.abs(y - (0.6 * x + 8 + 3 * Math.sin(x / 5))) < 1.1) t = "Ridge";
  if (t === "Grass" && (x * 7 + y * 13) % 53 === 0) t = "Town";
  for (const [lx, ly, r] of lakes) { const d = Math.hypot(x - lx, y - ly); if (d < r) t = "Water"; else if (d < r + 1.3) t = "Sand"; }
  world.set(cellKey(x, y), t);
}
const m = learnModel(world, { name: "world", orientation: "flat" });
const glyph: Record<string, string> = { Grass: ".", Water: "~", Sand: "s", Ridge: "^", Forest: "F", Town: "T" };
const show = (label: string, extra: Partial<SolveOptions>, cols = 40, rows = 16) => {
  const r = solve(m, { cols, rows, orientation: "flat", seed: 4, ...extra });
  if (!r.ok) { console.log(label, r.message); return; }
  const pc = countPatches(r.cells, { cols, rows, ox: 0, oy: 0, orientation: "flat", stagger: "odd" });
  console.log(`\n## ${label}  towns=${pc.get("Town") ?? 0} lakes=${pc.get("Water") ?? 0}`, JSON.stringify(r.stats), r.warnings.join("; "));
  for (let y = 0; y < rows; y++) { let s = ""; for (let x = 0; x < cols; x++) s += glyph[r.cells.get(cellKey(x, y))!] ?? "?"; console.log(s); }
};
const arg = process.argv[2] ?? "all";
const runs: [string, Partial<SolveOptions>][] = [
  ["baseline", {}],
  ["smoothing 1", { smoothing: 1 }],
  ["symmetry left-right", { symmetry: "left-right" }],
  ["island: edge Water strength 1", { edgeTerrain: "Water", edgeStrength: 1 }],
  ["counts: Town 3, Water 2-", { counts: { Town: { min: 3, max: 3 }, Water: { min: 2 } } }],
  ["spacing 2x", { spacing: 2 }],
  ["line width 3", { lineWidth: 3 }],
  ["connected, impassable Water+Ridge", { connected: true, impassable: ["Water", "Ridge"] }],
  ["mix Forest x3", { mix: { Forest: 3 } }],
];
for (const [label, extra] of runs) if (arg === "all" || label.startsWith(arg)) show(label, extra);
